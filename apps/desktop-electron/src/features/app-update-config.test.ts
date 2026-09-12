import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import {
  writeElectronUpdateConfig,
  resolveElectronUpdateUrl,
  resolveElectronUpdateFeed,
} from "./app-update-config.js";

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

it("uses the production release feed unless an explicit override is configured", () => {
  expect(resolveElectronUpdateUrl(undefined, "https://github.com/frogg-app/fde/releases")).toBe(
    "https://github.com/frogg-app/fde/releases/latest/download",
  );
  expect(resolveElectronUpdateUrl(" https://updates.example.com/fde ", null)).toBe(
    "https://updates.example.com/fde",
  );
  expect(resolveElectronUpdateUrl(undefined, null)).toBeNull();
});

const releaseBase = "https://github.com/frogg-app/fde/releases";

it("discovers beta tags independently of GitHub's stable latest download alias", async () => {
  const fetchReleases = vi.fn(async () => [
    { tag_name: "v0.6.0", draft: false },
    { tag_name: "v0.7.0-beta.2", draft: false },
    { tag_name: "v0.7.0-beta.1", draft: false },
    { tag_name: "v9.0.0", draft: true },
    { tag_name: "not-semver", draft: false },
  ]);
  await expect(
    resolveElectronUpdateFeed({ releaseBase, releaseChannel: "beta", fetchReleases }),
  ).resolves.toEqual({
    url: `${releaseBase}/download/v0.7.0-beta.2`,
    channel: "electron-beta",
  });
  expect(fetchReleases).toHaveBeenCalledWith(
    "https://api.github.com/repos/frogg-app/fde/releases?per_page=100",
  );
});

it("graduates beta users to a newer stable release using stable metadata", async () => {
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      releaseChannel: "beta",
      fetchReleases: async () => [
        { tag_name: "v0.7.0-beta.2", draft: false },
        { tag_name: "v0.7.0", draft: false },
      ],
    }),
  ).resolves.toEqual({ url: `${releaseBase}/download/v0.7.0`, channel: "electron-latest" });
});

it("keeps stable, explicit generic feeds, and disabled distributions out of beta discovery", async () => {
  const fetchReleases = vi.fn(async () => {
    throw new Error("unexpected discovery");
  });
  await expect(
    resolveElectronUpdateFeed({ releaseBase, releaseChannel: "stable", fetchReleases }),
  ).resolves.toEqual({
    url: `${releaseBase}/latest/download`,
    channel: "electron-latest",
  });
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      releaseChannel: "beta",
      override: "https://updates.example.com",
      fetchReleases,
    }),
  ).resolves.toEqual({
    url: "https://updates.example.com",
    channel: "electron-beta",
  });
  await expect(
    resolveElectronUpdateFeed({ releaseBase: null, releaseChannel: "beta", fetchReleases }),
  ).resolves.toBeNull();
  expect(fetchReleases).not.toHaveBeenCalled();
});

it("surfaces release discovery failures and rejects insecure overrides", async () => {
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      releaseChannel: "beta",
      fetchReleases: async () => [],
    }),
  ).rejects.toThrow("No published desktop release");
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      releaseChannel: "beta",
      fetchReleases: async () => {
        throw new Error("offline");
      },
    }),
  ).rejects.toThrow("offline");
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      releaseChannel: "beta",
      override: "http://updates.example.com",
    }),
  ).rejects.toThrow("HTTPS");
});
