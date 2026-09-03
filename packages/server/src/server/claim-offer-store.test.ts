import { describe, expect, test } from "vitest";

import { createClaimOfferStore } from "./claim-offer-store.js";

describe("claim offer store", () => {
  test("tokens are single-use", () => {
    const store = createClaimOfferStore();
    const offer = store.issue();
    expect(store.consume(offer.token)).toBe(true);
    expect(store.consume(offer.token)).toBe(false);
    expect(store.consume("not-a-token")).toBe(false);
  });

  test("tokens expire after the TTL", () => {
    let now = 1_000;
    const store = createClaimOfferStore({ ttlMs: 500, now: () => now });
    const offer = store.issue();
    expect(offer.expiresAt).toBe(new Date(1_500).toISOString());
    now = 1_501;
    expect(store.consume(offer.token)).toBe(false);
    expect(store.liveCount()).toBe(0);
  });

  test("older unexpired tokens keep working until the live cap is hit", () => {
    const store = createClaimOfferStore({ maxLive: 2 });
    const first = store.issue();
    const second = store.issue();
    const third = store.issue();
    expect(store.liveCount()).toBe(2);
    expect(store.consume(first.token)).toBe(false);
    expect(store.consume(second.token)).toBe(true);
    expect(store.consume(third.token)).toBe(true);
  });
});
