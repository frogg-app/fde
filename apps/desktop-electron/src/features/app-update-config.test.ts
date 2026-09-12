import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { writeElectronUpdateConfig } from "./app-update-config.js";

it("provides updater download cache metadata for an explicitly configured feed", () => {
  const root = mkdtempSync(path.join(tmpdir(), "electron-update-config-"));
  try {
    const file = writeElectronUpdateConfig(
      root,
      "https://updates.example/electron",
      "example-electron-updater",
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      provider: "generic",
      url: "https://updates.example/electron",
      updaterCacheDirName: "example-electron-updater",
    });
    expect(readdirSync(path.dirname(file))).toEqual(["app-update.yml"]);
    expect(() =>
      writeElectronUpdateConfig(root, "http://updates.example", "example-electron-updater"),
    ).toThrow("HTTPS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
