import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { detectServiceManager, serviceFileTargetsInstall } from "./service.js";

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fde-self-update-service-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("service detection", () => {
  test("only claims a unit that launches this install dir", () => {
    const dir = makeDir();
    const unit = path.join(dir, "fde-daemon.service");
    writeFileSync(
      unit,
      "[Service]\nExecStart=/home/me/.local/share/fde/current/bin/fde daemon start --foreground\n",
    );
    expect(serviceFileTargetsInstall(unit, "/home/me/.local/share/fde")).toBe(true);
    expect(serviceFileTargetsInstall(unit, "/tmp/scratch/install")).toBe(false);
    expect(serviceFileTargetsInstall(path.join(dir, "missing"), "/home/me/.local/share/fde")).toBe(
      false,
    );
    writeFileSync(unit, "[Service]\nEnvironment=FDE_INSTALL_DIR=/opt/fde\n");
    expect(serviceFileTargetsInstall(unit, "/opt/fde")).toBe(true);
  });

  test("a scratch install on a host with a real service falls back to unmanaged", () => {
    const manager = detectServiceManager({
      installDir: makeDir(),
      home: undefined,
      listen: "0.0.0.0:9993",
      platform: "linux",
    });
    expect(manager.kind).toBe("unmanaged");
  });
});
