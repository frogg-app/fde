import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const source = new URL("./branding-package-inspect.mjs", import.meta.url);
test("macOS inspection accepts stable bundle names and rejects missing executables or wrong identities", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "fde-package-inspect-"));
  try {
    // Run the real inspector with a fixture-local brand loader. Preparing a brand
    // in the source checkout races other script tests and changes their identity.
    mkdirSync(path.join(cwd, "scripts/ci"), { recursive: true });
    mkdirSync(path.join(cwd, "scripts/dev/branding"), { recursive: true });
    const script = pathToFileURL(path.join(cwd, "scripts/ci/branding-package-inspect.mjs")).href;
    copyFileSync(source, path.join(cwd, "scripts/ci/branding-package-inspect.mjs"));
    writeFileSync(
      path.join(cwd, "scripts/dev/branding/load.cjs"),
      'exports.loadBrand = () => ({id:"acme", applicationId:"com.acme.studio", artifactPrefix:"acme", name:"Acme Studio"});',
    );
    const output = path.join(cwd, "apps/desktop-electron/release");
    const contents = path.join(output, "mac-arm64/acme.app/Contents");
    mkdirSync(path.join(contents, "Resources/app-dist"), { recursive: true });
    mkdirSync(path.join(contents, "MacOS"), { recursive: true });
    writeFileSync(path.join(contents, "MacOS/acme"), "executable fixture");
    writeFileSync(path.join(contents, "Info.plist"), "plist fixture");
    writeFileSync(path.join(contents, "Resources/app.asar"), "archive fixture");
    writeFileSync(
      path.join(contents, "Resources/brand.json"),
      JSON.stringify({ id: "acme", applicationId: "com.acme.studio" }),
    );
    writeFileSync(path.join(output, "acme-0.6.21-mac-arm64.zip"), "artifact fixture");
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ version: "0.6.21" }));
    mkdirSync(path.join(cwd, "bin"));
    writeFileSync(
      path.join(cwd, "bin/plutil"),
      '#!/usr/bin/env bash\ncase "$2" in CFBundleExecutable) echo acme ;; CFBundleIdentifier) echo "${TEST_APP_ID:-com.acme.studio}" ;; *) exit 1 ;; esac\n',
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${cwd}/bin:${process.env.PATH}`,
    };
    const args = [
      "--input-type=module",
      "-e",
      `Object.defineProperty(process, "platform", {value:"darwin"}); Object.defineProperty(process, "arch", {value:"arm64"}); await import(${JSON.stringify(script)});`,
    ];
    function run(extra = {}) {
      return execFileSync(process.execPath, args, {
        cwd,
        env: { ...env, ...extra },
        stdio: "pipe",
      });
    }
    assert.match(run().toString(), /verified/);
    assert.throws(() => run({ TEST_APP_ID: "wrong.identity" }));
    rmSync(path.join(contents, "MacOS/acme"));
    assert.throws(() => run(), /selected desktop executable was produced/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
