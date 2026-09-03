import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createClaimStore, hashCredential, PRINCIPALS_FILENAME } from "./claim-store.js";

const homes: string[] = [];

function createHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "fde-claim-store-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("claim store", () => {
  test("a fresh home is unclaimed and has no credentials", () => {
    const store = createClaimStore(createHome());
    expect(store.isClaimed()).toBe(false);
    expect(store.claimedAt()).toBeNull();
    expect(store.credentialHashes()).toEqual([]);
  });

  test("minting the first principal claims the daemon and persists only a digest", () => {
    const home = createHome();
    const store = createClaimStore(home);
    const minted = store.mintPrincipal({ label: "Alice's laptop" });

    expect(store.isClaimed()).toBe(true);
    expect(store.claimedAt()).not.toBeNull();
    expect(store.credentialHashes()).toEqual([hashCredential(minted.credential)]);
    expect(minted.permissions).toContain("access.manage");

    const raw = readFileSync(path.join(home, PRINCIPALS_FILENAME), "utf8");
    expect(raw).not.toContain(minted.credential);
    expect(raw).toContain("Alice's laptop");
    if (process.platform !== "win32") {
      expect(statSync(path.join(home, PRINCIPALS_FILENAME)).mode & 0o777).toBe(0o600);
    }
  });

  test("picks up an external rewrite of the file and reset unclaims", () => {
    const home = createHome();
    const store = createClaimStore(home);
    store.mintPrincipal({ label: "first" });
    const claimedAt = store.claimedAt();

    // Another process (fde daemon reset-claim) removes the file while the daemon runs.
    const other = createClaimStore(home);
    expect(other.reset()).toBe(true);
    expect(store.isClaimed()).toBe(false);
    expect(other.reset()).toBe(false);

    store.mintPrincipal({ label: "second" });
    expect(store.read().principals.map((principal) => principal.label)).toEqual(["second"]);
    expect(store.claimedAt()).not.toBe(claimedAt);
  });

  test("rejects a corrupt principals file instead of treating it as unclaimed", () => {
    const home = createHome();
    writeFileSync(path.join(home, PRINCIPALS_FILENAME), '{"version":1,"principals":"nope"}');
    const store = createClaimStore(home);
    expect(() => store.isClaimed()).toThrow();
  });
});
