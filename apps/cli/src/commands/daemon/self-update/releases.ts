import { z } from "zod";
import { compareVersions, isNewerVersion, parseVersion } from "./semver.js";

/**
 * Release lookup against the GitHub Releases API, mirroring
 * apps/desktop/src-tauri/src/updates/github.rs: `FDE_GITHUB_TOKEN` raises the
 * rate limit and lets a private repository answer, and is never logged.
 */
export const DEFAULT_RELEASES_API = "https://api.github.com/repos/frogg-app/fde/releases";
export const DEFAULT_RELEASE_BASE = "https://github.com/frogg-app/fde/releases";
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
  /** GitHub Releases API listing URL (`FDE_RELEASES_API`). */
  apiUrl: string;
  /** Download base for `<base>/download/v<version>/<asset>` (`FDE_RELEASE_BASE`). */
  releaseBase: string;
  /** True when `FDE_RELEASE_BASE` was set explicitly, so the mirror wins over asset URLs. */
  releaseBaseOverridden: boolean;
  token: string | null;
}

export function resolveReleaseSource(env: NodeJS.ProcessEnv = process.env): ReleaseSource {
  const token = env.FDE_GITHUB_TOKEN?.trim() || null;
  const releaseBase = env.FDE_RELEASE_BASE?.trim().replace(/\/+$/, "") || null;
  return {
    apiUrl: env.FDE_RELEASES_API?.trim() || DEFAULT_RELEASES_API,
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

function statusHint(status: number): string {
  if (status === 403 || status === 429) {
    return " (GitHub rate limit; set FDE_GITHUB_TOKEN to raise it)";
  }
  if (status === 404) {
    return " (repository or releases not found; FDE_GITHUB_TOKEN is needed for a private repository)";
  }
  return "";
}

export async function fetchReleases(
  source: ReleaseSource,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubRelease[]> {
  const separator = source.apiUrl.includes("?") ? "&" : "?";
  const url = `${source.apiUrl}${separator}per_page=${RELEASES_PER_PAGE}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: githubHeaders(source.token, userAgent),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `release check failed: HTTP ${response.status}${statusHint(response.status)}`,
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
