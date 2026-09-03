import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { resolveLoopbackHttpBase } from "../daemon-http.js";
import { resolveLocalDaemonState } from "../local-daemon.js";
import {
  bundleAssetName,
  detectBundleTarget,
  downloadFile,
  extractBundle,
  verifyBundleChecksum,
  type BundleTarget,
} from "./bundle.js";
import {
  appendSelfUpdateLog,
  isVersionInstalled,
  pruneVersions,
  readCurrentVersion,
  readLastUpdate,
  resolveInstallDir,
  tempDir,
  versionRoot,
  versionsDir,
  writePreviousVersion,
  type LastUpdateRecord,
} from "./layout.js";
import {
  fetchReleases,
  releaseDownloadUrl,
  resolveReleaseSource,
  selectRelease,
  type ReleaseSource,
  type UpdateChannel,
} from "./releases.js";
import { SELF_UPDATE_LOG_FILE } from "./layout.js";
import { spawnDetachedSupervisor } from "./service.js";
import { DEFAULT_VERIFY_TIMEOUT_MS } from "./verify.js";

/**
 * `fde daemon self-update`: resolve, download, verify, install next to the
 * running version, then hand off to the detached `--apply` supervisor. Every
 * step is idempotent: a version already under `versions/` is not downloaded
 * again, and the current version is never re-applied.
 */
export type SelfUpdatePhase = "check" | "download" | "verify" | "install" | "restart";

export type SelfUpdateStatus =
  | "check"
  | "up_to_date"
  | "not_updatable"
  | "handoff"
  | "applied"
  | "rolled_back"
  | "failed";

export interface SelfUpdateProgress {
  event: "progress";
  phase: SelfUpdatePhase;
  message: string;
}

export interface SelfUpdateResult {
  event: "result";
  status: SelfUpdateStatus;
  installDir: string;
  currentVersion: string | null;
  targetVersion: string | null;
  updatable: boolean;
  updateAvailable: boolean;
  channel: UpdateChannel;
  reason: string | null;
  releaseUrl: string | null;
  lastUpdate: LastUpdateRecord | null;
}

export interface SelfUpdateOptions {
  version?: string;
  channel: UpdateChannel;
  check: boolean;
  wait: boolean;
  home?: string;
  installDir?: string;
  verifyTimeoutMs?: number;
}

export interface SelfUpdateRuntime {
  env: NodeJS.ProcessEnv;
  cliVersion: string;
  execPath: string;
  cliEntry: string;
  platform: NodeJS.Platform;
  emit: (event: SelfUpdateProgress) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface ResolvedCandidate {
  version: string;
  archiveUrl: string;
  checksumUrl: string;
  headers: Record<string, string>;
  releaseUrl: string | null;
}

export function describeNotUpdatable(installDir: string, env: NodeJS.ProcessEnv): string | null {
  if (env.FDE_DOCKER === "1" || existsSync("/.dockerenv")) {
    return "this daemon runs in Docker; pull the new image and re-run install-docker.sh --update";
  }
  if (readCurrentVersion(installDir) === null) {
    return `${installDir} is not a versioned install (no current link); run deploy/install.sh or update the checkout`;
  }
  return null;
}

async function resolveCandidate(
  options: SelfUpdateOptions,
  runtime: SelfUpdateRuntime,
  source: ReleaseSource,
  currentVersion: string,
  target: BundleTarget,
): Promise<ResolvedCandidate | null> {
  const assetName = (version: string) => bundleAssetName(version, target);
  const userAgent = `FDE/${runtime.cliVersion}`;
  if (options.version && source.releaseBaseOverridden) {
    const version = options.version.replace(/^v/, "");
    const url = releaseDownloadUrl(source.releaseBase, version, assetName(version));
    return { version, archiveUrl: url, checksumUrl: `${url}.sha256`, headers: {}, releaseUrl: null };
  }
  const releases = await fetchReleases(source, userAgent, runtime.fetchImpl);
  const candidate = selectRelease({
    releases,
    currentVersion,
    channel: options.channel,
    assetName,
    version: options.version,
  });
  if (!candidate) {
    if (options.version) {
      throw new Error(
        `release v${options.version.replace(/^v/, "")} has no ${assetName(options.version.replace(/^v/, ""))}`,
      );
    }
    return null;
  }
  if (source.releaseBaseOverridden) {
    const url = releaseDownloadUrl(source.releaseBase, candidate.version, candidate.asset.name);
    return {
      version: candidate.version,
      archiveUrl: url,
      checksumUrl: `${url}.sha256`,
      headers: {},
      releaseUrl: candidate.release.html_url ?? null,
    };
  }
  // A token means the repository may be private: the API asset URL with an
  // octet-stream accept header works there, the browser URL does not.
  const useApi = source.token !== null && candidate.asset.url !== undefined;
  return {
    version: candidate.version,
    archiveUrl: useApi ? (candidate.asset.url as string) : candidate.asset.browser_download_url,
    checksumUrl: useApi
      ? (candidate.checksumAsset?.url ?? `${candidate.asset.browser_download_url}.sha256`)
      : `${candidate.asset.browser_download_url}.sha256`,
    headers: {
      "user-agent": userAgent,
      ...(useApi ? { accept: "application/octet-stream", authorization: `Bearer ${source.token}` } : {}),
    },
    releaseUrl: candidate.release.html_url ?? null,
  };
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function installCandidate(
  installDir: string,
  candidate: ResolvedCandidate,
  target: BundleTarget,
  runtime: SelfUpdateRuntime,
): Promise<void> {
  if (isVersionInstalled(installDir, candidate.version)) {
    runtime.emit({
      event: "progress",
      phase: "install",
      message: `version ${candidate.version} is already present`,
    });
    return;
  }
  const work = tempDir(installDir);
  const archivePath = path.join(work, bundleAssetName(candidate.version, target));
  const sidecarPath = `${archivePath}.sha256`;
  runtime.emit({ event: "progress", phase: "download", message: `downloading ${candidate.archiveUrl}` });
  let lastReported = 0;
  await downloadFile({
    url: candidate.archiveUrl,
    destination: archivePath,
    headers: candidate.headers,
    fetchImpl: runtime.fetchImpl,
    onProgress: (received, total) => {
      if (received - lastReported < 16 * 1024 * 1024) return;
      lastReported = received;
      runtime.emit({
        event: "progress",
        phase: "download",
        message: total ? `${formatMiB(received)} of ${formatMiB(total)}` : formatMiB(received),
      });
    },
  });
  await downloadFile({
    url: candidate.checksumUrl,
    destination: sidecarPath,
    headers: candidate.headers,
    fetchImpl: runtime.fetchImpl,
  });
  runtime.emit({ event: "progress", phase: "verify", message: "verifying checksum" });
  const digest = await verifyBundleChecksum(archivePath, sidecarPath);
  runtime.emit({ event: "progress", phase: "verify", message: `sha256 ${digest.slice(0, 12)} ok` });

  runtime.emit({ event: "progress", phase: "install", message: `unpacking into ${versionRoot(installDir, candidate.version)}` });
  const staging = path.join(versionsDir(installDir), `.staging.${candidate.version}.${process.pid}`);
  await extractBundle(archivePath, staging, target.platform);
  rmSync(versionRoot(installDir, candidate.version), { recursive: true, force: true });
  renameSync(staging, versionRoot(installDir, candidate.version));
  rmSync(archivePath, { force: true });
  rmSync(sidecarPath, { force: true });
}

function resolveHttpBase(options: SelfUpdateOptions, env: NodeJS.ProcessEnv): string | null {
  const listen = env.PASEO_LISTEN?.trim() || resolveLocalDaemonState({ home: options.home }).listen;
  return resolveLoopbackHttpBase(listen);
}

async function waitForOutcome(
  installDir: string,
  startedAt: string,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<LastUpdateRecord | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = readLastUpdate(installDir);
    if (record && record.at > startedAt) return record;
    await sleep(1000);
  }
  return null;
}

export async function runSelfUpdate(
  options: SelfUpdateOptions,
  runtime: SelfUpdateRuntime,
): Promise<SelfUpdateResult> {
  const installDir = options.installDir ?? resolveInstallDir(runtime.env);
  const base = {
    event: "result" as const,
    installDir,
    channel: options.channel,
    releaseUrl: null,
    lastUpdate: readLastUpdate(installDir),
  };
  const notUpdatable = describeNotUpdatable(installDir, runtime.env);
  const currentVersion = readCurrentVersion(installDir);
  if (notUpdatable || currentVersion === null) {
    return {
      ...base,
      status: "not_updatable",
      currentVersion: currentVersion ?? runtime.cliVersion,
      targetVersion: null,
      updatable: false,
      updateAvailable: false,
      reason: notUpdatable ?? "not a versioned install",
    };
  }

  const target = detectBundleTarget(runtime.platform);
  const source = resolveReleaseSource(runtime.env);
  runtime.emit({
    event: "progress",
    phase: "check",
    message: options.version
      ? `resolving v${options.version.replace(/^v/, "")}`
      : `checking ${source.apiUrl} for ${options.channel} releases above ${currentVersion}`,
  });
  const candidate = await resolveCandidate(options, runtime, source, currentVersion, target);
  const upToDate = candidate === null || candidate.version === currentVersion;
  const common = {
    ...base,
    currentVersion,
    targetVersion: candidate?.version ?? null,
    updatable: true,
    updateAvailable: !upToDate,
    releaseUrl: candidate?.releaseUrl ?? null,
  };
  if (options.check) return { ...common, status: "check", reason: null };
  if (upToDate || candidate === null) {
    return { ...common, status: "up_to_date", reason: `already on ${currentVersion}` };
  }

  await installCandidate(installDir, candidate, target, runtime);
  writePreviousVersion(installDir, currentVersion);
  const removed = pruneVersions(installDir, { protect: [currentVersion, candidate.version] });
  if (removed.length > 0) appendSelfUpdateLog(installDir, `pruned ${removed.join(", ")}`);

  const httpBase = resolveHttpBase(options, runtime.env);
  const startedAt = new Date().toISOString();
  const args = [
    "daemon",
    "self-update",
    "--apply",
    candidate.version,
    "--previous",
    currentVersion,
    "--install-dir",
    installDir,
    ...(httpBase ? ["--http-base", httpBase] : []),
    ...(options.home ? ["--home", options.home] : []),
    ...(options.verifyTimeoutMs ? ["--verify-timeout", String(options.verifyTimeoutMs)] : []),
  ];
  appendSelfUpdateLog(installDir, `handing off to supervisor: ${currentVersion} -> ${candidate.version}`);
  const spawned = spawnDetachedSupervisor({
    execPath: runtime.execPath,
    cliEntry: runtime.cliEntry,
    args,
    logPath: path.join(installDir, SELF_UPDATE_LOG_FILE),
    env: runtime.env,
  });
  runtime.emit({
    event: "progress",
    phase: "restart",
    message: `supervisor started (${spawned.via}${spawned.pid ? ` pid ${spawned.pid}` : ""}); the daemon restarts into ${candidate.version}`,
  });
  if (!options.wait) return { ...common, status: "handoff", reason: null };

  const sleep = runtime.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const budget = (options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS) * 2 + 60_000;
  const outcome = await waitForOutcome(installDir, startedAt, budget, sleep);
  if (!outcome) {
    return { ...common, status: "failed", reason: "timed out waiting for the supervisor", lastUpdate: readLastUpdate(installDir) };
  }
  return { ...common, status: outcome.status, reason: outcome.reason, lastUpdate: outcome };
}
