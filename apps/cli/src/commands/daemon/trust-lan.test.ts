import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPersistedConfig } from "@fde/server";
import { afterEach, describe, expect, test } from "vitest";

import { describeClaimStatus } from "./claim.js";
import { parseTrustLanMode, setTrustLanInConfig, type TrustLanApplied } from "./trust-lan.js";

const homes: string[] = [];

function createHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "fde-cli-trust-lan-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("daemon trust-lan", () => {
  test("parses on/off spellings and rejects anything else", () => {
    expect(parseTrustLanMode("on")).toBe("on");
    expect(parseTrustLanMode("TRUE")).toBe("on");
    expect(parseTrustLanMode("off")).toBe("off");
    expect(parseTrustLanMode("0")).toBe("off");
    expect(() => parseTrustLanMode("maybe")).toThrow(
      expect.objectContaining({ code: "TRUST_LAN_MODE_INVALID" }),
    );
  });

  test("writes daemon.auth.trustLan next to an existing password and reports a restart when nothing runs", async () => {
    const home = createHome();
    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: {
          auth: { password: "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW" },
        },
      }),
    );

    const off = await setTrustLanInConfig("off", { home });
    expect(off).toMatchObject({
      action: "trust_lan_set",
      trustLan: false,
      configPath: path.join(home, "config.json"),
      applied: { status: "restart_required" },
    });
    expect(off.message).toContain("daemon.auth.trustLan=false");
    expect(loadPersistedConfig(home).daemon?.auth).toMatchObject({ trustLan: false });
    expect(loadPersistedConfig(home).daemon?.auth?.password).toBeDefined();
    expect((await describeClaimStatus(home)).lanTrusted).toBe(false);

    const on = await setTrustLanInConfig("on", { home });
    expect(on.trustLan).toBe(true);
    expect(loadPersistedConfig(home).daemon?.auth?.trustLan).toBe(true);
    expect((await describeClaimStatus(home)).lanTrusted).toBe(true);
  });

  test("applies live through the running daemon's config reload", async () => {
    const home = createHome();
    // This test process stands in for the daemon: the pid file makes the CLI treat it as running.
    writeFileSync(
      path.join(home, "paseo.pid"),
      JSON.stringify({ pid: process.pid, listen: "127.0.0.1:65001" }),
    );
    const reloads: string[] = [];
    const outcomes: TrustLanApplied[] = [
      { status: "live" },
      { status: "env_override" },
      { status: "restart_required", reason: "config reload failed (boom)" },
    ];
    async function reloadLive(listen: string): Promise<TrustLanApplied> {
      reloads.push(listen);
      return outcomes.shift() ?? { status: "live" };
    }

    const live = await setTrustLanInConfig("off", { home, reloadLive });
    expect(live.applied).toEqual({ status: "live" });
    expect(live.message).toContain("Applied to the running daemon.");
    expect(reloads).toEqual(["127.0.0.1:65001"]);

    const overridden = await setTrustLanInConfig("on", { home, reloadLive });
    expect(overridden.applied).toEqual({ status: "env_override" });
    expect(overridden.message).toContain("PASEO_TRUST_LAN");

    const failed = await setTrustLanInConfig("on", { home, reloadLive });
    expect(failed.applied).toEqual({
      status: "restart_required",
      reason: "config reload failed (boom)",
    });
    expect(failed.message).toContain("fde daemon restart");
  });
});
