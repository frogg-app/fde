import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { renderInstallerScript } = await tsImport("./branding/installers.mts", import.meta.url);

for (const file of ["install.sh", "uninstall.sh", "install-docker.sh", "uninstall-docker.sh"]) {
  test(`${file} generated from a Windows checkout remains executable Bash`, async () => {
    const source = await readFile(new URL(`../../deploy/${file}`, import.meta.url), "utf8");
    const defaults = "BRAND_ID='example'\nBRAND_NAME='Example'";
    const windowsSource = source.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
    const script = renderInstallerScript(windowsSource, defaults, "com.example.app");
    assert.equal(script.startsWith("#!/usr/bin/env bash\n"), true);
    assert.equal(script.includes("\r"), false);
    assert.equal(script.includes("# Generated distribution: com.example.app\n" + defaults), true);
    assert.equal(script, renderInstallerScript(source, defaults, "com.example.app"));
  });
}

test("refuses an installer without its distribution defaults block", () => {
  assert.throws(
    () => renderInstallerScript("#!/usr/bin/env bash\r\n", "", "com.example.app"),
    /no distribution defaults block/,
  );
});
