import { afterEach, describe, expect, it, vi } from "vitest";

async function loadModuleForPlatform(platform: "web" | "ios" | "android") {
  vi.resetModules();
  vi.doMock("react-native", () => ({ Platform: { OS: platform } }));
  return import("./desktop-updates");
}

describe("desktop-updates helpers", () => {
  afterEach(() => {
    vi.doUnmock("react-native");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("normalizes versions for app-daemon comparisons", async () => {
    const { normalizeVersionForComparison } = await loadModuleForPlatform("web");

    expect(normalizeVersionForComparison(" v0.1.15 ")).toBe("0.1.15");
    expect(normalizeVersionForComparison("0.1.15")).toBe("0.1.15");
    expect(normalizeVersionForComparison(null)).toBeNull();
  });

  it("detects version mismatch after normalization", async () => {
    const { isVersionMismatch } = await loadModuleForPlatform("web");

    expect(isVersionMismatch("v0.1.15", "0.1.15")).toBe(false);
    expect(isVersionMismatch("0.1.15", "0.1.16")).toBe(true);
    expect(isVersionMismatch("0.1.15", null)).toBe(false);
  });

  it("formats display versions with v prefix and unavailable fallback", async () => {
    const { formatVersionWithPrefix } = await loadModuleForPlatform("web");

    expect(formatVersionWithPrefix("0.2.0")).toBe("v0.2.0");
    expect(formatVersionWithPrefix("v0.2.0")).toBe("v0.2.0");
    expect(formatVersionWithPrefix(null)).toBe("\u2014");
  });

  it("parses valid local daemon version result", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(parseLocalDaemonVersionResult({ version: "0.1.15", error: null })).toEqual({
      version: "0.1.15",
      error: null,
    });
  });

  it("parses local daemon version error result", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(
      parseLocalDaemonVersionResult({ version: null, error: "paseo command not found in PATH" }),
    ).toEqual({
      version: null,
      error: "paseo command not found in PATH",
    });
  });

  it("parses unexpected local daemon version result", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(parseLocalDaemonVersionResult(null)).toEqual({
      version: null,
      error: "Unexpected response from version check.",
    });

    expect(parseLocalDaemonVersionResult("not an object")).toEqual({
      version: null,
      error: "Unexpected response from version check.",
    });
  });

  it("trims whitespace in parsed version", async () => {
    const { parseLocalDaemonVersionResult } = await loadModuleForPlatform("web");

    expect(parseLocalDaemonVersionResult({ version: " 0.1.15 ", error: null })).toEqual({
      version: "0.1.15",
      error: null,
    });
  });

  it("builds copyable daemon update diagnostics", async () => {
    const { buildDaemonUpdateDiagnostics } = await loadModuleForPlatform("web");
    const diagnostics = buildDaemonUpdateDiagnostics({
      exitCode: 1,
      stdout: "stdout text",
      stderr: "stderr text",
    });

    expect(diagnostics).toContain("Exit code: 1");
    expect(diagnostics).toContain("STDOUT:\nstdout text");
    expect(diagnostics).toContain("STDERR:\nstderr text");
  });

  it("parses runtime info defensively", async () => {
    const { parseDesktopRuntimeInfo } = await loadModuleForPlatform("web");

    expect(
      parseDesktopRuntimeInfo({
        appVersion: " 0.1.64 ",
        runningUnderARM64Translation: true,
      }),
    ).toEqual({
      appVersion: "0.1.64",
      runningUnderARM64Translation: true,
      updateStrategy: null,
    });
    expect(
      parseDesktopRuntimeInfo({ appVersion: "1", updateStrategy: "github-release" }).updateStrategy,
    ).toBe("github-release");
    expect(parseDesktopRuntimeInfo(null)).toEqual({
      appVersion: null,
      runningUnderARM64Translation: false,
      updateStrategy: null,
    });
  });

  it("parses the shell's check result including release notes and the asset plan", async () => {
    const { parseDesktopAppUpdateCheckResult } = await loadModuleForPlatform("web");

    expect(
      parseDesktopAppUpdateCheckResult({
        hasUpdate: true,
        readyToInstall: true,
        currentVersion: "0.1.11",
        latestVersion: "0.2.0",
        body: "## Notes",
        date: "2026-09-01T00:00:00Z",
        errorMessage: null,
        asset: { name: "FDE-0.2.0-amd64.deb", size: 12345, url: "https://x" },
        installKind: "linux-deb",
        releaseUrl: "https://github.com/frogg-app/frogg-de/releases/tag/v0.2.0",
        strategy: "github-release",
        channel: "stable",
        checkedAt: 1_700_000_000_000,
      }),
    ).toEqual({
      hasUpdate: true,
      readyToInstall: true,
      currentVersion: "0.1.11",
      latestVersion: "0.2.0",
      body: "## Notes",
      date: "2026-09-01T00:00:00Z",
      errorMessage: null,
      notes: "## Notes",
      assetName: "FDE-0.2.0-amd64.deb",
      assetSize: 12345,
      installKind: "linux-deb",
      releaseUrl: "https://github.com/frogg-app/frogg-de/releases/tag/v0.2.0",
      strategy: "github-release",
      checkedAt: 1_700_000_000_000,
    });

    // Electron's narrower shape (the signed updater path) still parses.
    const legacy = parseDesktopAppUpdateCheckResult({
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: "1",
      latestVersion: "1",
      body: null,
      date: null,
      errorMessage: "offline",
      installKind: "unknown",
    });
    expect(legacy).toMatchObject({
      errorMessage: "offline",
      notes: null,
      assetName: null,
      installKind: null,
      strategy: null,
      checkedAt: null,
    });
    expect(() => parseDesktopAppUpdateCheckResult("nope")).toThrow(/Unexpected response/);
  });

  it("builds the direct Apple Silicon DMG URL from a version", async () => {
    const { buildMacAppleSiliconDownloadUrl } = await loadModuleForPlatform("web");

    expect(buildMacAppleSiliconDownloadUrl("v0.1.64")).toBe(
      "https://github.com/frogg-app/frogg-de/releases/download/v0.1.64/FDE_0.1.64_aarch64.dmg",
    );
    expect(buildMacAppleSiliconDownloadUrl(null)).toBeNull();
  });
});
