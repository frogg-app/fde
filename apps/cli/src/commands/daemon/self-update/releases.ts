import { brand } from "@frogg/branding";
import { brandEnv } from "@frogg/branding/identity";
import { z } from "zod";
import { readGitHubCliToken } from "./github-auth.js";
import { compareVersions, isNewerVersion, parseVersion } from "./semver.js";

/**
 * Release lookup against the GitHub Releases API, mirroring
 * apps/desktop/src-tauri/src/updates/github.rs: `FROGG_GITHUB_TOKEN` raises the
 * rate limit and lets a private repository answer, and is never logged.
 */
export const DEFAULT_RELEASES_API = brand.distribution.releasesApi ?? "";
export const DEFAULT_RELEASE_BASE = brand.distribution.releaseBase ?? "";
const RELEASES_PER_PAGE = 30;
const FETCH_TIMEOUT_MS = 30_000;

export type UpdateChannel = "stable" | "beta";

const ReleaseAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string(),
  url: z.string().optional(),
});

const ReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  html_url: z.string().optional(),
  assets: z.array(ReleaseAssetSchema).default([]),
});

export type GitHubRelease = z.infer<typeof ReleaseSchema>;
export type GitHubReleaseAsset = z.infer<typeof ReleaseAssetSchema>;

export interface ReleaseSource {
  /** GitHub Releases API listing URL (`FROGG_RELEASES_API`). */
  apiUrl: string;
  /** Download base for `<base>/download/v<version>/<asset>` (`FROGG_RELEASE_BASE`). */
  releaseBase: string;
  /** True when `FROGG_RELEASE_BASE` was set explicitly, so the mirror wins over asset URLs. */
  releaseBaseOverridden: boolean;
  token: string | null;
}

export function resolveReleaseSource(env: NodeJS.ProcessEnv = process.env): ReleaseSource {
  const token = brandEnv(brand, env, "GITHUB_TOKEN") || null;
  const releaseBase = brandEnv(brand, env, "RELEASE_BASE")?.replace(/\/+$/, "") || null;
  return {
    apiUrl: brandEnv(brand, env, "RELEASES_API") || DEFAULT_RELEASES_API,
    releaseBase: releaseBase ?? DEFAULT_RELEASE_BASE,
    releaseBaseOverridden: releaseBase !== null,
    token,
  };
}

export function githubHeaders(token: string | null, userAgent: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": userAgent,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function statusHint(status: number, headers: Headers): string {
  if (status === 403 || status === 429) {
    const reset = Number(headers.get("x-ratelimit-reset"));
    const resetDate = new Date(reset * 1000);
    const retry =
      reset > 0 && Number.isFinite(resetDate.getTime())
        ? `; retry after ${resetDate.toISOString()}`
        : "; retry later";
    return ` (GitHub rate limit or access restriction${retry}, or authenticate with gh auth login / FROGG_GITHUB_TOKEN)`;
  }
  if (status === 404) {
    return " (repository or releases not found; FROGG_GITHUB_TOKEN is needed for a private repository)";
  }
  return "";
}

function canUseAmbientToken(source: ReleaseSource, status: number): boolean {
  return (
    !source.token &&
    source.apiUrl === DEFAULT_RELEASES_API &&
    new URL(source.apiUrl).origin === "https://api.github.com" &&
    !source.releaseBaseOverridden &&
    (status === 403 || status === 429)
  );
}

export async function fetchReleases(
  source: ReleaseSource,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
  auth: { env?: NodeJS.ProcessEnv; readGhToken?: () => Promise<string | null> } = {},
): Promise<GitHubRelease[]> {
  if (brand.distribution.updateMode === "disabled")
    throw new Error(`Updates are disabled for ${brand.name}`);
  if (!source.apiUrl) throw new Error("No release API configured");
  const separator = source.apiUrl.includes("?") ? "&" : "?";
  const url = `${source.apiUrl}${separator}per_page=${RELEASES_PER_PAGE}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response = await fetchImpl(url, {
      headers: githubHeaders(source.token, userAgent),
      signal: controller.signal,
    });
    // Ambient credentials are only for the built-in public API. Keep them out of
    // ReleaseSource so asset download and mirror requests cannot inherit them.
    if (canUseAmbientToken(source, response.status)) {
      const env = auth.env ?? process.env;
      const token =
        env.GH_TOKEN?.trim() ||
        env.GITHUB_TOKEN?.trim() ||
        (await (auth.readGhToken ?? readGitHubCliToken)());
      if (token && !controller.signal.aborted) {
        await response.body?.cancel();
        response = await fetchImpl(url, {
          headers: githubHeaders(token, userAgent),
          signal: controller.signal,
          redirect: "error",
        });
      }
    }
    if (!response.ok) {
      throw new Error(
        `release check failed: HTTP ${response.status}${statusHint(response.status, response.headers)}`,
      );
    }
    const parsed = z.array(ReleaseSchema).safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("release check returned unexpected JSON");
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

export interface ReleaseCandidate {
  version: string;
  release: GitHubRelease;
  asset: GitHubReleaseAsset;
  checksumAsset: GitHubReleaseAsset | null;
}

function releaseVersion(release: GitHubRelease): string | null {
  return parseVersion(release.tag_name)?.raw ?? null;
}

function matchesChannel(release: GitHubRelease, channel: UpdateChannel): boolean {
  if (release.draft) return false;
  if (channel === "stable") {
    return release.prerelease !== true && parseVersion(release.tag_name)?.prerelease === null;
  }
  return true;
}

/**
 * Picks the release to install: an exact `version` when given (any channel,
 * but never a draft), otherwise the newest version above `currentVersion`
 * that carries `assetName`. Ordering comes from the tags, not the API order.
 */
export function selectRelease(input: {
  releases: GitHubRelease[];
  currentVersion: string;
  channel: UpdateChannel;
  assetName: (version: string) => string;
  version?: string;
}): ReleaseCandidate | null {
  const candidates: ReleaseCandidate[] = [];
  for (const release of input.releases) {
    const version = releaseVersion(release);
    if (!version || release.draft) continue;
    if (input.version) {
      if (version !== parseVersion(input.version)?.raw) continue;
    } else {
      if (!matchesChannel(release, input.channel)) continue;
      if (!isNewerVersion(version, input.currentVersion)) continue;
    }
    const name = input.assetName(version);
    const asset = release.assets.find((entry) => entry.name === name);
    if (!asset) continue;
    candidates.push({
      version,
      release,
      asset,
      checksumAsset: release.assets.find((entry) => entry.name === `${name}.sha256`) ?? null,
    });
  }
  candidates.sort((a, b) => {
    const pa = parseVersion(a.version);
    const pb = parseVersion(b.version);
    return pa && pb ? compareVersions(pb, pa) : 0;
  });
  return candidates[0] ?? null;
}

/** `<releaseBase>/download/v<version>/<name>`, the layout install.sh uses. */
export function releaseDownloadUrl(releaseBase: string, version: string, name: string): string {
  return `${releaseBase.replace(/\/+$/, "")}/download/v${version}/${name}`;
}
