import { mkdirSync, writeFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
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
  test("a new service uses wildcard defaults without pinning the listener", () => {
    const homeDir = scratchHome();
    try {
      const installed = installLoginService({
        platform: "darwin",
        homeDir,
        env: { PATH: "/usr/bin" },
      });
      expect(installed.listen).toBe("0.0.0.0:9999");
      const configPath = path.join(homeDir, ".fde", "config.json");
      expect(JSON.parse(readFileSync(configPath, "utf8")).daemon.listen).toBe("0.0.0.0:9999");
      expect(readFileSync(installed.file!, "utf8")).not.toContain("<key>FDE_LISTEN</key>");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test.each([
    [undefined, undefined, "127.0.0.1:8123", false],
    [undefined, "   ", "127.0.0.1:8123", false],
    [undefined, "[::1]:8124", "[::1]:8124", true],
    ["127.0.0.1:8125", "[::1]:8124", "127.0.0.1:8125", true],
  ])(
    "respects config, environment and flag precedence (%s, %s)",
    (listen, envListen, expected, pinned) => {
      const homeDir = scratchHome();
      const home = path.join(homeDir, ".fde");
      mkdirSync(home);
      writeFileSync(
        path.join(home, "config.json"),
        JSON.stringify({ daemon: { listen: "127.0.0.1:8123" } }),
      );
      try {
        const installed = installLoginService({
          platform: "darwin",
          homeDir,
          env: { PATH: "/usr/bin", FDE_HOME: home, FDE_LISTEN: envListen },
          listen,
        });
        expect(installed.listen).toBe(expected);
        expect(installed.home).toBe(home);
        const plist = readFileSync(installed.file!, "utf8");
        expect(plist.includes("<key>FDE_LISTEN</key>")).toBe(pinned);
        expect(plist.includes(`<string>${expected}</string>`)).toBe(pinned);
      } finally {
        rmSync(homeDir, { recursive: true, force: true });
      }
    },
  );

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
