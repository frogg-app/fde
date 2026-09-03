import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  isVersionInstalled,
  listInstalledVersions,
  pruneVersions,
  readCurrentVersion,
  readLastUpdate,
  readPreviousVersion,
  resolveInstallDir,
  setCurrentVersion,
  versionRoot,
  writeLastUpdate,
  writePreviousVersion,
} from "./layout.js";

const dirs: string[] = [];
function makeInstallDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fde-self-update-layout-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake versioned install: manifest.json plus bin/fde, the markers the layout checks. */
export function installFakeVersion(installDir: string, version: string): string {
  const root = versionRoot(installDir, version);
  mkdirSync(path.join(root, "bin"), { recursive: true });
  writeFileSync(path.join(root, "bin", "fde"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({ version, platform: "linux", arch: "x64" }),
  );
  return root;
}

describe("install dir layout", () => {
  test("resolves the install dir from FDE_INSTALL_DIR with the installer's default", () => {
    expect(resolveInstallDir({ FDE_INSTALL_DIR: "/opt/fde " })).toBe("/opt/fde");
    if (process.platform !== "win32") {
      expect(resolveInstallDir({})).toBe(path.join(os.homedir(), ".local", "share", "fde"));
    }
  });

  test("flips current atomically and keeps the previous marker in step", () => {
    const installDir = makeInstallDir();
    expect(readCurrentVersion(installDir)).toBeNull();
    installFakeVersion(installDir, "0.1.13");
    installFakeVersion(installDir, "0.1.14");
    expect(isVersionInstalled(installDir, "0.1.14")).toBe(true);
    expect(isVersionInstalled(installDir, "0.1.15")).toBe(false);

    setCurrentVersion(installDir, "0.1.13");
    expect(readCurrentVersion(installDir)).toBe("0.1.13");
    expect(readlinkSync(path.join(installDir, "current"))).toBe(path.join("versions", "0.1.13"));

    writePreviousVersion(installDir, readCurrentVersion(installDir));
    setCurrentVersion(installDir, "0.1.14");
    expect(readCurrentVersion(installDir)).toBe("0.1.14");
    expect(readPreviousVersion(installDir)).toBe("0.1.13");
    expect(existsSync(path.join(installDir, "current.new"))).toBe(false);
    expect(() => setCurrentVersion(installDir, "9.9.9")).toThrow(/not installed/);

    // Rolling back is the same flip in the other direction.
    setCurrentVersion(installDir, "0.1.13");
    expect(readCurrentVersion(installDir)).toBe("0.1.13");
  });

  test("keeps the newest three versions and never removes current or previous", () => {
    const installDir = makeInstallDir();
    for (const version of ["0.1.9", "0.1.10", "0.1.11", "0.1.12", "0.1.13", "0.1.14"]) {
      installFakeVersion(installDir, version);
    }
    mkdirSync(path.join(installDir, "versions", ".staging.0.1.15.123"), { recursive: true });
    expect(listInstalledVersions(installDir)).toEqual([
      "0.1.14",
      "0.1.13",
      "0.1.12",
      "0.1.11",
      "0.1.10",
      "0.1.9",
    ]);

    const removed = pruneVersions(installDir, { protect: ["0.1.14", "0.1.9"] });
    expect(removed).toEqual(["0.1.11", "0.1.10"]);
    expect(listInstalledVersions(installDir)).toEqual(["0.1.14", "0.1.13", "0.1.12", "0.1.9"]);
    expect(pruneVersions(installDir, { keep: 1, protect: ["0.1.14", null] })).toEqual([
      "0.1.13",
      "0.1.12",
      "0.1.9",
    ]);
  });

  test("round-trips last-update.json and ignores malformed content", () => {
    const installDir = makeInstallDir();
    expect(readLastUpdate(installDir)).toBeNull();
    writeLastUpdate(installDir, {
      from: "0.1.13",
      to: "0.1.14",
      status: "rolled_back",
      reason: "timed out",
      at: "2026-09-03T00:00:00.000Z",
    });
    expect(readLastUpdate(installDir)).toEqual({
      from: "0.1.13",
      to: "0.1.14",
      status: "rolled_back",
      reason: "timed out",
      at: "2026-09-03T00:00:00.000Z",
    });
    writeFileSync(path.join(installDir, "last-update.json"), '{"status":"weird"}');
    expect(readLastUpdate(installDir)).toBeNull();
  });
});
