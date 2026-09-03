import { randomBytes } from "node:crypto";

/**
 * In-memory claim tokens for the first-run pairing gate. Every token is
 * single-use and expires; issuing a new one never invalidates an earlier
 * unexpired one, so a phone that scanned an older QR still pairs, but the
 * store keeps at most `maxLive` tokens to bound memory.
 */
export const CLAIM_OFFER_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_LIVE_OFFERS = 16;

export interface ClaimOffer {
  token: string;
  expiresAt: string;
}

export interface ClaimOfferStore {
  issue(): ClaimOffer;
  /** Consumes the token; returns false when unknown, expired, or already used. */
  consume(token: string): boolean;
  liveCount(): number;
}

interface ClaimOfferStoreOptions {
  ttlMs?: number;
  maxLive?: number;
  now?: () => number;
}

export function createClaimOfferStore(options: ClaimOfferStoreOptions = {}): ClaimOfferStore {
  const ttlMs = options.ttlMs ?? CLAIM_OFFER_TTL_MS;
  const maxLive = options.maxLive ?? DEFAULT_MAX_LIVE_OFFERS;
  const now = options.now ?? (() => Date.now());
  const live = new Map<string, number>();

  function prune(): void {
    const current = now();
    for (const [token, expiresAtMs] of live) {
      if (expiresAtMs <= current) live.delete(token);
    }
    while (live.size > maxLive) {
      const oldest = live.keys().next().value;
      if (oldest === undefined) break;
      live.delete(oldest);
    }
  }

  return {
    issue: () => {
      prune();
      const token = randomBytes(24).toString("base64url");
      const expiresAtMs = now() + ttlMs;
      live.set(token, expiresAtMs);
      prune();
      return { token, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    consume: (token) => {
      prune();
      const expiresAtMs = live.get(token);
      if (expiresAtMs === undefined) return false;
      live.delete(token);
      return expiresAtMs > now();
    },
    liveCount: () => {
      prune();
      return live.size;
    },
  };
}
