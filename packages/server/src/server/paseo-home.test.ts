import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import {
  consumeHomeMigrationNotice,
  resetHomeMigrationStateForTests,
  resolveFdeHome,
  resolvePaseoHome,
} from "./paseo-home.js";
import { PRIVATE_DIRECTORY_MODE } from "./private-files.js";

const MODE_MASK = 0o777;

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("resolvePaseoHome permissions", () => {
  test("creates PASEO_HOME with private permissions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "paseo-home-parent-"));
    const paseoHome = path.join(parent, "home");
    try {
      expect(resolvePaseoHome({ PASEO_HOME: paseoHome })).toBe(paseoHome);
      expect(modeOf(paseoHome)).toBe(PRIVATE_DIRECTORY_MODE);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("FDE home resolution order", () => {
  function scratch(): string {
    return mkdtempSync(path.join(tmpdir(), "fde-home-order-"));
  }

  test("FDE_HOME wins over PASEO_HOME", () => {
    const parent = scratch();
    try {
      const fdeHome = path.join(parent, "fde");
      const legacyHome = path.join(parent, "paseo");
      expect(resolveFdeHome({ FDE_HOME: fdeHome, PASEO_HOME: legacyHome })).toBe(fdeHome);
      expect(existsSync(legacyHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("PASEO_HOME still works as a fallback", () => {
    const parent = scratch();
    try {
      const legacyHome = path.join(parent, "paseo");
      expect(resolveFdeHome({ PASEO_HOME: legacyHome })).toBe(legacyHome);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("an empty env var is ignored, so the default home applies", () => {
    const parent = scratch();
    try {
      vi.spyOn(os, "homedir").mockReturnValue(parent);
      resetHomeMigrationStateForTests();
      expect(resolveFdeHome({ FDE_HOME: "   ", PASEO_HOME: "" })).toBe(path.join(parent, ".fde"));
    } finally {
      vi.restoreAllMocks();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("legacy home migration", () => {
  test("moves ~/.paseo to ~/.fde once and reports it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "fde-home-migrate-"));
    try {
      const legacy = path.join(parent, ".paseo");
      mkdirSync(legacy, { recursive: true });
      writeFileSync(path.join(legacy, "config.json"), '{"version":1}\n');
      vi.spyOn(os, "homedir").mockReturnValue(parent);
      resetHomeMigrationStateForTests();

      const home = resolveFdeHome({});

      expect(home).toBe(path.join(parent, ".fde"));
      expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe('{"version":1}\n');
      expect(existsSync(legacy)).toBe(false);
      const notice = consumeHomeMigrationNotice();
      expect(notice).toEqual({ from: legacy, to: home, mode: "renamed" });
      // Reported once only.
      expect(consumeHomeMigrationNotice()).toBeNull();
    } finally {
      vi.restoreAllMocks();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("keeps an existing ~/.fde and leaves ~/.paseo alone", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "fde-home-keep-"));
    try {
      const legacy = path.join(parent, ".paseo");
      const target = path.join(parent, ".fde");
      mkdirSync(legacy, { recursive: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(legacy, "config.json"), "legacy\n");
      writeFileSync(path.join(target, "config.json"), "current\n");
      vi.spyOn(os, "homedir").mockReturnValue(parent);
      resetHomeMigrationStateForTests();

      expect(resolveFdeHome({})).toBe(target);
      expect(readFileSync(path.join(target, "config.json"), "utf8")).toBe("current\n");
      expect(existsSync(legacy)).toBe(true);
      expect(consumeHomeMigrationNotice()).toBeNull();
    } finally {
      vi.restoreAllMocks();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("does not migrate when an env var points the home elsewhere", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "fde-home-env-"));
    try {
      const legacy = path.join(parent, ".paseo");
      mkdirSync(legacy, { recursive: true });
      vi.spyOn(os, "homedir").mockReturnValue(parent);
      resetHomeMigrationStateForTests();

      const explicit = path.join(parent, "elsewhere");
      expect(resolveFdeHome({ FDE_HOME: explicit })).toBe(explicit);
      expect(existsSync(legacy)).toBe(true);
      expect(existsSync(path.join(parent, ".fde"))).toBe(false);
      expect(consumeHomeMigrationNotice()).toBeNull();
    } finally {
      vi.restoreAllMocks();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("migration safety", () => {
  test("leaves a legacy home alone while a daemon is running from it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "fde-home-inuse-"));
    try {
      const legacy = path.join(parent, ".paseo");
      mkdirSync(legacy, { recursive: true });
      writeFileSync(path.join(legacy, "paseo.pid"), JSON.stringify({ pid: process.pid }));
      vi.spyOn(os, "homedir").mockReturnValue(parent);
      resetHomeMigrationStateForTests();

      expect(resolveFdeHome({})).toBe(path.join(parent, ".fde"));
      expect(existsSync(path.join(legacy, "paseo.pid"))).toBe(true);
      expect(consumeHomeMigrationNotice()).toBeNull();
    } finally {
      vi.restoreAllMocks();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
