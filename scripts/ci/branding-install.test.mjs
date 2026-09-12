import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBrand } from "../dev/branding/load.cjs";
const brand = loadBrand();
const repo = path.resolve(import.meta.dirname, "../..");

test(
  "generated installer owns only its commands and rejects a foreign uninstall",
  { skip: process.platform === "win32" },
  () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "brand installer "));
    try {
      const bundle = path.join(scratch, "bundle");
      mkdirSync(path.join(bundle, "node/bin"), { recursive: true });
      mkdirSync(path.join(bundle, "bin"));
      symlinkSync(process.execPath, path.join(bundle, "node/bin/node"));
      const commands = brand.legacyFde ? [brand.cliName, "paseo"] : [brand.cliName];
      for (const name of commands)
        writeFileSync(path.join(bundle, "bin", name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(
        path.join(bundle, "manifest.json"),
        JSON.stringify(
          {
            version: "1.2.3",
            platform: process.platform,
            arch: process.arch,
            brand: { id: brand.id, applicationId: brand.applicationId },
          },
          null,
          2,
        ),
      );
      const archive = path.join(scratch, "fixture.tar.gz");
      execFileSync("tar", ["-czf", archive, "-C", scratch, "bundle"]);
      const install = path.join(scratch, "install root");
      const bin = path.join(scratch, "commands");
      const env = {
        ...process.env,
        HOME: path.join(scratch, "home"),
        [`${brand.envPrefix}_INSTALL_DIR`]: install,
        [`${brand.envPrefix}_BIN_DIR`]: bin,
        [`${brand.envPrefix}_BUNDLE_FILE`]: archive,
        [`${brand.envPrefix}_NO_SERVICE`]: "1",
        [`${brand.envPrefix}_NO_MODIFY_PATH`]: "1",
      };
      const run = (script) =>
        spawnSync("bash", [path.join(repo, ".generated/branding/scripts", script)], {
          env,
          encoding: "utf8",
        });
      const installed = run("install.sh");
      assert.equal(installed.status, 0, installed.stdout + installed.stderr);
      assert.equal(existsSync(path.join(bin, brand.cliName)), true);
      assert.equal(
        readFileSync(path.join(install, ".brand-identity"), "utf8").trim(),
        `${brand.id}:${brand.applicationId}`,
      );
      if (!brand.legacyFde) {
        assert.equal(existsSync(path.join(bin, "fde")), false);
        assert.equal(existsSync(path.join(bin, "paseo")), false);
      }
      writeFileSync(path.join(install, ".brand-identity"), "foreign:com.foreign.app\n");
      const refused = run("uninstall.sh");
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /another product/);
      assert.equal(existsSync(path.join(install, "current")), true);
      // No service was created: hide service-manager binaries during the scratch uninstall.
      const safePath = path.join(scratch, "safe tools");
      mkdirSync(safePath);
      for (const name of ["bash", "uname", "cat", "readlink", "rm"])
        symlinkSync(
          execFileSync("which", [name], { encoding: "utf8" }).trim(),
          path.join(safePath, name),
        );
      env.PATH = safePath;
      writeFileSync(path.join(install, ".brand-identity"), `${brand.id}:${brand.applicationId}\n`);
      const removed = run("uninstall.sh");
      assert.equal(removed.status, 0, removed.stderr);
      assert.equal(existsSync(install), false);
      assert.equal(existsSync(bundle), true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);
