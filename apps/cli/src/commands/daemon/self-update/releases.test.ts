import { describe, expect, test } from "vitest";
import { bundleAssetName } from "./bundle.js";
import {
  fetchReleases,
  githubHeaders,
  releaseDownloadUrl,
  resolveReleaseSource,
  selectRelease,
  type GitHubRelease,
} from "./releases.js";
import { compareVersionStrings, isNewerVersion, parseVersion } from "./semver.js";

const target = { platform: "linux", arch: "x64" } as const;
const assetName = (version: string) => bundleAssetName(version, target);

function release(tag: string, options: { prerelease?: boolean; draft?: boolean; assets?: boolean } = {}) {
  const version = tag.replace(/^v/, "");
  const name = assetName(version);
  const assets =
    options.assets === false
      ? []
      : [
          { name, browser_download_url: `https://dl/${tag}/${name}`, url: `https://api/${tag}/1` },
          { name: `${name}.sha256`, browser_download_url: `https://dl/${tag}/${name}.sha256` },
        ];
  return {
    tag_name: tag,
    prerelease: options.prerelease ?? false,
    draft: options.draft ?? false,
    html_url: `https://github.com/frogg-app/fde/releases/tag/${tag}`,
    assets,
  } satisfies GitHubRelease;
}

describe("semver", () => {
  test("parses tags and orders prereleases below releases", () => {
    expect(parseVersion("v0.1.13")?.raw).toBe("0.1.13");
    expect(parseVersion("0.2.0-beta.2")?.prerelease).toBe("beta.2");
    expect(parseVersion("latest")).toBeNull();
    expect(isNewerVersion("0.1.14", "0.1.13")).toBe(true);
    expect(isNewerVersion("0.2.0-beta.1", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.2.0", "0.2.0-beta.1")).toBe(true);
    expect(["0.1.9", "0.1.10", "0.1.10-rc.1"].sort(compareVersionStrings)).toEqual([
      "0.1.9",
      "0.1.10-rc.1",
      "0.1.10",
    ]);
  });
});

describe("selectRelease", () => {
  const releases = [
    release("v0.1.12"),
    release("v0.2.0-beta.1", { prerelease: true }),
    release("v0.1.15", { draft: true }),
    release("v0.1.14", { assets: false }),
    release("v0.1.13"),
    release("v0.1.16-rc.1"),
  ];

  test("picks the newest stable release above the current one that carries the asset", () => {
    const picked = selectRelease({ releases, currentVersion: "0.1.12", channel: "stable", assetName });
    expect(picked?.version).toBe("0.1.13");
    expect(picked?.asset.name).toBe(assetName("0.1.13"));
    expect(picked?.checksumAsset?.name).toBe(`${assetName("0.1.13")}.sha256`);
  });

  test("beta channel accepts prereleases, sorted by version rather than API order", () => {
    const picked = selectRelease({ releases, currentVersion: "0.1.12", channel: "beta", assetName });
    expect(picked?.version).toBe("0.2.0-beta.1");
  });

  test("returns null when nothing newer exists and honours an exact version", () => {
    expect(selectRelease({ releases, currentVersion: "0.1.13", channel: "stable", assetName })).toBeNull();
    expect(
      selectRelease({ releases, currentVersion: "0.1.13", channel: "stable", assetName, version: "v0.1.12" })
        ?.version,
    ).toBe("0.1.12");
    expect(
      selectRelease({ releases, currentVersion: "0.1.13", channel: "stable", assetName, version: "0.1.15" }),
    ).toBeNull();
  });
});

describe("release source", () => {
  test("reads env overrides and never puts the token anywhere but the header", () => {
    const source = resolveReleaseSource({
      FDE_RELEASE_BASE: "http://127.0.0.1:9990/",
      FDE_GITHUB_TOKEN: " tok ",
    });
    expect(source).toMatchObject({
      releaseBase: "http://127.0.0.1:9990",
      releaseBaseOverridden: true,
      token: "tok",
    });
    expect(resolveReleaseSource({}).releaseBaseOverridden).toBe(false);
    expect(githubHeaders("tok", "FDE/1.0.0")).toMatchObject({
      authorization: "Bearer tok",
      "user-agent": "FDE/1.0.0",
    });
    expect(githubHeaders(null, "FDE/1.0.0")).not.toHaveProperty("authorization");
    expect(releaseDownloadUrl("http://127.0.0.1:9990/", "0.1.14", "x.tar.gz")).toBe(
      "http://127.0.0.1:9990/download/v0.1.14/x.tar.gz",
    );
  });

  test("fetchReleases explains rate limits and rejects unexpected JSON", async () => {
    const source = resolveReleaseSource({});
    const limited = () =>
      Promise.resolve(new Response("", { status: 403 })) as unknown as ReturnType<typeof fetch>;
    await expect(fetchReleases(source, "FDE/1", limited)).rejects.toThrow(/rate limit/);
    const junk = () =>
      Promise.resolve(new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as unknown as ReturnType<
        typeof fetch
      >;
    await expect(fetchReleases(source, "FDE/1", junk)).rejects.toThrow(/unexpected JSON/);
    const ok = (url: string | URL | Request) => {
      expect(String(url)).toContain("per_page=30");
      return Promise.resolve(new Response(JSON.stringify([release("v0.1.13")]), { status: 200 }));
    };
    const releases = await fetchReleases(source, "FDE/1", ok as unknown as typeof fetch);
    expect(releases[0]?.tag_name).toBe("v0.1.13");
  });
});
