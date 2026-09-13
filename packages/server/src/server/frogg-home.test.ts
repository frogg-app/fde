import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveFdeHome } from "./fde-home.js";
import { PRIVATE_DIRECTORY_MODE } from "./private-files.js";

const roots: string[] = [];
function scratch(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "fde-home-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("FDE home", () => {
  test.skipIf(process.platform === "win32")(
    "creates a configured home with private permissions",
    () => {
      const home = path.join(scratch(), "home");
      expect(resolveFdeHome({ FDE_HOME: home })).toBe(home);
      expect(statSync(home).mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE);
    },
  );
  test("uses the default home for an empty environment variable", () => {
    const parent = scratch();
    vi.spyOn(os, "homedir").mockReturnValue(parent);
    expect(resolveFdeHome({ FDE_HOME: "   " })).toBe(path.join(parent, ".fde"));
  });
  test("expands a configured relative home", () => {
    const parent = scratch();
    vi.spyOn(os, "homedir").mockReturnValue(parent);
    expect(resolveFdeHome({ FDE_HOME: "~/state" })).toBe(path.join(parent, "state"));
  });
  test("preserves existing default home state", () => {
    const parent = scratch();
    const home = path.join(parent, ".fde");
    mkdirSync(home);
    writeFileSync(path.join(home, "config.json"), "existing config");
    vi.spyOn(os, "homedir").mockReturnValue(parent);
    expect(resolveFdeHome({})).toBe(home);
    expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe("existing config");
  });
});
