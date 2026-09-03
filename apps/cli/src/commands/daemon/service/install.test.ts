import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { installLoginService, uninstallLoginService } from "./install.js";
import { LAUNCHD_LABEL } from "./plan.js";

/**
 * Uses the launchd plan with a scratch home: `launchctl` does not exist here,
 * so the commands fail harmlessly and the file writing is what is under test.
 */
function scratchHome(): string {
  return mkdtempSync(path.join(tmpdir(), "fde-service-home-"));
}

describe("login service files", () => {
  test("install writes the agent, uninstall removes it", () => {
    const homeDir = scratchHome();
    try {
      const installed = installLoginService({
        platform: "darwin",
        homeDir,
        env: { PATH: "/usr/bin" },
        listen: "127.0.0.1:9991",
        home: path.join(homeDir, ".fde"),
      });

      const plistPath = path.join(homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
      expect(installed.action).toBe("installed");
      expect(installed.file).toBe(plistPath);
      expect(installed.listen).toBe("127.0.0.1:9991");
      expect(readFileSync(plistPath, "utf8")).toContain("<key>RunAtLoad</key><true/>");

      const removed = uninstallLoginService({
        platform: "darwin",
        homeDir,
        env: { PATH: "/usr/bin" },
      });
      expect(removed.action).toBe("uninstalled");
      expect(existsSync(plistPath)).toBe(false);

      expect(
        uninstallLoginService({ platform: "darwin", homeDir, env: { PATH: "/usr/bin" } }).action,
      ).toBe("not_installed");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
