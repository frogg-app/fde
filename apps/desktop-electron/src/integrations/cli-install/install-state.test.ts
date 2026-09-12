import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installedCliMatches, assertReplaceableCli, windowsCliLauncher } from "./installed-cli.js";
import { ensureWindowsUserPath } from "./windows-path.js";

describe("installed CLI identity", () => {
  it.skipIf(process.platform === "win32")(
    "rejects dangling and unrelated targets while accepting the selected bundle",
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fde-cli-test-"));
      const sourcePath = path.join(directory, "bundled");
      const targetPath = path.join(directory, "cli");
      try {
        await fs.symlink(sourcePath, targetPath);
        expect(await installedCliMatches({ platform: "linux", sourcePath, targetPath })).toBe(
          false,
        );
        await fs.writeFile(sourcePath, "#!/bin/sh\n");
        expect(await installedCliMatches({ platform: "linux", sourcePath, targetPath })).toBe(true);
        await fs.unlink(targetPath);
        await fs.writeFile(targetPath, "user-owned executable");
        expect(await installedCliMatches({ platform: "linux", sourcePath, targetPath })).toBe(
          false,
        );
        await expect(assertReplaceableCli(targetPath)).rejects.toThrow("unrelated CLI");
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("requires the expected Windows wrapper and a present bundled shim", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fde-cli-test-"));
    const sourcePath = path.join(directory, "bundle.cmd");
    const targetPath = path.join(directory, "cli.cmd");
    try {
      await fs.writeFile(sourcePath, "@echo off\n");
      await fs.writeFile(targetPath, "@echo unrelated\n");
      expect(await installedCliMatches({ platform: "win32", sourcePath, targetPath })).toBe(false);
      await fs.writeFile(targetPath, windowsCliLauncher(sourcePath));
      expect(await installedCliMatches({ platform: "win32", sourcePath, targetPath })).toBe(true);
      await expect(assertReplaceableCli(targetPath)).resolves.toBeUndefined();
      await fs.unlink(sourcePath);
      expect(await installedCliMatches({ platform: "win32", sourcePath, targetPath })).toBe(false);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("escapes percent expansion in Windows install paths and disables delayed expansion", () => {
    const launcher = windowsCliLauncher("C:\\Users\\100% User!\\bundle.cmd");
    expect(launcher).toContain("100%% User!");
    expect(launcher).toContain("setlocal DisableDelayedExpansion");
  });
});

describe("Windows user PATH adapter", () => {
  it("preserves user entries and updates current process without storing machine PATH", () => {
    let stored = "C:\\UserTools";
    const env = { Path: "C:\\Windows;C:\\UserTools" };
    ensureWindowsUserPath({
      directory: "C:\\Users\\User\\.local\\bin",
      env,
      readPath: () => stored,
      writePath: (value) => {
        stored = value;
      },
    });
    expect(stored).toBe("C:\\UserTools;C:\\Users\\User\\.local\\bin");
    expect(env.Path).toBe("C:\\Users\\User\\.local\\bin;C:\\Windows;C:\\UserTools");
  });

  it("does not duplicate case-insensitive existing entries", () => {
    let writes = 0;
    ensureWindowsUserPath({
      directory: "C:\\Users\\User\\.local\\bin",
      env: {},
      readPath: () => 'C:\\Tools;"c:\\users\\user\\.local\\bin\\"',
      writePath: () => {
        writes++;
      },
    });
    expect(writes).toBe(0);
  });

  it("propagates registry failures instead of reporting successful installation", () => {
    expect(() =>
      ensureWindowsUserPath({
        directory: "C:\\bin",
        env: {},
        readPath: () => "",
        writePath: () => {
          throw new Error("access denied");
        },
      }),
    ).toThrow("access denied");
  });
});
