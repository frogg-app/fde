import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@fde/branding", async () => {
  const { resolveBrandManifest } = await import("@fde/branding/schema");
  return {
    brand: resolveBrandManifest({
      schemaVersion: 1,
      id: "acme",
      name: "Acme Studio",
      applicationId: "com.acme.studio",
      daemonPort: 10099,
      assets: { icon: "icon.png" },
    }),
  };
});
import { brand } from "@fde/branding";
import { resolveFdeHomePath } from "../../utils/fde-home.js";
import { readBundleManifest, bundleAssetName, bundleLauncherPath } from "./self-update/bundle.js";
import { resolveReleaseSource, fetchReleases } from "./self-update/releases.js";
import { resolveInstallDir, setCurrentVersion } from "./self-update/layout.js";
import { resolveServicePlan } from "./service/plan.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function scratch() {
  const root = mkdtempSync(path.join(os.tmpdir(), "brand isolation "));
  roots.push(root);
  return root;
}

test("homes, commands, artifacts and services use the independent identity", () => {
  expect(resolveFdeHomePath({ FDE_HOME: "/foreign", ACME_HOME: "/own" })).toBe("/own");
  expect(resolveInstallDir({ FDE_INSTALL_DIR: "/foreign", ACME_INSTALL_DIR: "/own" })).toBe("/own");
  expect(bundleAssetName("1.2.3", { platform: "linux", arch: "x64" })).toBe(
    "acme-daemon-1.2.3-linux-x64.tar.gz",
  );
  expect(bundleLauncherPath("/own", "win")).toBe(path.join("/own", "bin", "acme.cmd"));
  const plan = resolveServicePlan({
    platform: "linux",
    homeDir: "/user",
    env: {},
    command: { program: "/Acme Studio/bin/acme", args: ["daemon", "start"] },
    listen: "127.0.0.1:10099",
    fdeHome: "/state with spaces",
  });
  expect(plan.label).toBe("acme-daemon");
  expect(plan.file?.contents).toContain('ExecStart="/Acme Studio/bin/acme"');
  expect(plan.file?.contents).toContain('Environment="ACME_HOME=/state with spaces"');
  expect(plan.file?.contents).not.toContain("FDE_HOME");
});

test("legacy and foreign bundles fail before switching an installation", () => {
  const root = scratch();
  const version = path.join(root, "versions", "1.2.3");
  mkdirSync(path.join(version, "bin"), { recursive: true });
  const manifest = { version: "1.2.3", platform: "linux", arch: "x64" };
  writeFileSync(path.join(version, "manifest.json"), JSON.stringify(manifest));
  expect(() => setCurrentVersion(root, "1.2.3")).toThrow(/another product/);
  writeFileSync(
    path.join(version, "manifest.json"),
    JSON.stringify({ ...manifest, brand: { id: "fde", applicationId: "app.frogg.fde" } }),
  );
  expect(() => readBundleManifest(version)).toThrow(/another product/);
  writeFileSync(
    path.join(version, "manifest.json"),
    JSON.stringify({
      ...manifest,
      brand: { id: brand.id, applicationId: brand.applicationId },
      fingerprint: "cosmetic-change",
    }),
  );
  expect(readBundleManifest(version).version).toBe("1.2.3");
  expect(() => setCurrentVersion(root, "1.2.3")).not.toThrow();
});

test("disabled custom updates make no requests and inherit no FDE endpoints", async () => {
  const source = resolveReleaseSource({
    FDE_RELEASE_BASE: "https://github.com/frogg-app/fde/releases",
  });
  expect(source.apiUrl).toBe("");
  expect(source.releaseBase).toBe("");
  const fetchImpl = vi.fn();
  await expect(fetchReleases(source, "acme", fetchImpl)).rejects.toThrow(/disabled/);
  expect(fetchImpl).not.toHaveBeenCalled();
});
