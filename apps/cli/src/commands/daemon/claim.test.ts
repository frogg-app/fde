import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaimStore } from "@fde/server";
import { afterEach, describe, expect, test } from "vitest";

import { describeClaimStatus, resetClaim } from "./claim.js";
import { resolveLoopbackHttpBase } from "./daemon-http.js";

const homes: string[] = [];

function createHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "fde-cli-claim-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("daemon claim-status / reset-claim", () => {
  test("reports an unclaimed home, then the paired principal, then resets it", async () => {
    const home = createHome();

    const before = await describeClaimStatus(home);
    expect(before).toMatchObject({
      claimed: false,
      claimedAt: null,
      passwordConfigured: false,
      pairingRequired: true,
      principals: [],
      daemon: { reachable: false },
    });

    createClaimStore(home).mintPrincipal({ label: "Phone" });
    const after = await describeClaimStatus(home);
    expect(after.claimed).toBe(true);
    expect(after.pairingRequired).toBe(false);
    expect(after.principals).toHaveLength(1);
    expect(after.principals[0]).toMatchObject({ label: "Phone", credentials: 1 });

    const reset = resetClaim(home);
    expect(reset).toMatchObject({ action: "claim_reset", removedPrincipals: 1 });
    expect((await describeClaimStatus(home)).claimed).toBe(false);
    expect(resetClaim(home).action).toBe("not_claimed");
  });

  test("turns a listen target into a loopback HTTP base", () => {
    expect(resolveLoopbackHttpBase("0.0.0.0:9999")).toBe("http://127.0.0.1:9999");
    expect(resolveLoopbackHttpBase("[::]:9999")).toBe("http://127.0.0.1:9999");
    expect(resolveLoopbackHttpBase("192.168.1.5:9999")).toBe("http://192.168.1.5:9999");
    expect(resolveLoopbackHttpBase("9998")).toBe("http://127.0.0.1:9998");
    expect(resolveLoopbackHttpBase("/tmp/paseo.sock")).toBeNull();
  });
});
