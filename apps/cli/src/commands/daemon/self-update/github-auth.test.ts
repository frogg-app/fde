import { describe, expect, test, vi } from "vitest";
import { readGitHubCliToken } from "./github-auth.js";
import { fetchReleases, resolveReleaseSource } from "./releases.js";

const success = () => Response.json([]);
const limited = () => new Response(null, { status: 403 });

describe("release credential fallback", () => {
  test.each([403, 429])("retries HTTP %s once with an existing gh login", async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(success());
    const readGhToken = vi.fn(async () => "test-gh-token");
    const source = resolveReleaseSource({});
    await expect(fetchReleases(source, "test", fetcher, { env: {}, readGhToken })).resolves.toEqual(
      [],
    );
    expect(readGhToken).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty("authorization");
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      headers: { authorization: "Bearer test-gh-token" },
      redirect: "error",
    });
    expect(source.token).toBeNull();
  });

  test.each([
    [{ GH_TOKEN: "test-gh-env", GITHUB_TOKEN: "test-github-env" }, "test-gh-env"],
    [{ GITHUB_TOKEN: "test-github-env" }, "test-github-env"],
  ])("uses ambient env credentials before querying gh", async (env, token) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(success());
    const readGhToken = vi.fn(async () => null);
    await fetchReleases(resolveReleaseSource({}), "test", fetcher, { env, readGhToken });
    expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty("authorization", `Bearer ${token}`);
    expect(readGhToken).not.toHaveBeenCalled();
  });

  test.each([
    { FROGG_RELEASES_API: "https://mirror.example/releases" },
    { FROGG_RELEASES_API: "http://api.github.com/repos/frogg-app/frogg/releases" },
    { FROGG_RELEASES_API: "https://api.github.com/other/releases" },
    { FROGG_RELEASES_API: "https://api.github.com.evil.test/releases" },
    { FROGG_RELEASE_BASE: "https://mirror.example/releases" },
  ])("never reuses credentials for overridden sources: %j", async (overrides) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => limited());
    const readGhToken = vi.fn(async () => "test-gh-token");
    await expect(
      fetchReleases(resolveReleaseSource(overrides), "test", fetcher, {
        env: { GH_TOKEN: "test-ambient-token" },
        readGhToken,
      }),
    ).rejects.toThrow("HTTP 403");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty("authorization");
    expect(readGhToken).not.toHaveBeenCalled();
  });

  test("explicit Frogg token wins and is never replaced after an authentication failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => limited());
    const readGhToken = vi.fn(async () => "test-gh-token");
    await expect(
      fetchReleases(
        resolveReleaseSource({ FROGG_GITHUB_TOKEN: "test-explicit" }),
        "test",
        fetcher,
        {
          env: { GH_TOKEN: "test-ambient" },
          readGhToken,
        },
      ),
    ).rejects.toThrow("HTTP 403");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
      "authorization",
      "Bearer test-explicit",
    );
    expect(readGhToken).not.toHaveBeenCalled();
  });

  test("no login preserves rate-limit error and reset guidance without retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 403,
        headers: { "x-ratelimit-reset": "1800000000" },
      }),
    );
    await expect(
      fetchReleases(resolveReleaseSource({}), "test", fetcher, {
        env: {},
        readGhToken: async () => null,
      }),
    ).rejects.toThrow(/retry after .*gh auth login/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("an authenticated rate-limit response ends after one retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => limited());
    await expect(
      fetchReleases(resolveReleaseSource({}), "test", fetcher, {
        env: { GH_TOKEN: "test-ambient" },
      }),
    ).rejects.toThrow("HTTP 403");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("successful public requests never inspect gh credentials", async () => {
    const readGhToken = vi.fn(async () => "test-gh-token");
    await fetchReleases(
      resolveReleaseSource({}),
      "test",
      vi.fn<typeof fetch>().mockResolvedValue(success()),
      {
        env: {},
        readGhToken,
      },
    );
    expect(readGhToken).not.toHaveBeenCalled();
  });
});

describe("gh credential command", () => {
  test("uses a bounded direct command pinned to github.com", async () => {
    const execute = vi.fn(async () => ({ stdout: " test-token\n" }));
    expect(await readGitHubCliToken(execute)).toBe("test-token");
    expect(execute).toHaveBeenCalledWith("gh", ["auth", "token", "--hostname", "github.com"], {
      timeout: 5000,
      maxBuffer: 16384,
      encoding: "utf8",
      windowsHide: true,
      killSignal: "SIGKILL",
    });
  });
  test("discards credential process failures without exposing output", async () => {
    expect(
      await readGitHubCliToken(async () => {
        throw new Error("test-secret-output");
      }),
    ).toBeNull();
  });
});
