/**
 * `GET /code/:code` and `GET /pair?code=…`: the pairing landing page the
 * daemon serves for its own pairing links, so `pair.frogg.app` can be
 * reverse-proxied to a daemon (see pairing-code-page.ts).
 *
 * Public by design — the code itself is the secret — and deliberately
 * incurious: anything that is not a live pairing code for this daemon renders
 * the same "expired" page, so the route reveals nothing about which codes
 * exist, which daemon this is, or whether it is claimed.
 */
import type express from "express";
import type { RequestHandler } from "express";

import { parseAnyConnectionOfferFromUrl } from "@fde/protocol/connection-offer";
import { renderPairingQrSvg } from "./pairing-qr.js";
import type { ClaimOfferStore } from "./claim-offer-store.js";
import { renderExpiredPairingPage, renderPairingCodePage } from "./pairing-code-page.js";

export interface PairingCodeRouteDependencies {
  serverId: string;
  offers: ClaimOfferStore;
  /** The canonical pairing base URL, so the QR carries the link people share. */
  pairingBaseUrl: () => string;
}

const MAX_CODE_LENGTH = 8192;
const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

interface ResolvedCode {
  hostname: string | null;
  canPairThisBrowser: boolean;
}

/**
 * Decodes a code without trusting it. Returns null for anything malformed,
 * expired, or not an offer — every one of which renders the same page.
 */
export function resolvePairingCode(
  code: string,
  deps: PairingCodeRouteDependencies,
  now: number = Date.now(),
): ResolvedCode | null {
  if (!code || code.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(code)) return null;

  let offer;
  try {
    offer = parseAnyConnectionOfferFromUrl(`#offer=${code}`);
  } catch {
    return null;
  }
  if (!offer) return null;
  if (offer.v !== 3) {
    // A relay (v2) offer carries no expiry and no claim token; it is still a
    // link the app can open, but this daemon cannot pair a browser with it.
    return { hostname: null, canPairThisBrowser: false };
  }

  if (Date.parse(offer.claim.expiresAt) <= now) return null;
  const isOwnOffer = offer.serverId === deps.serverId;
  const tokenLive = isOwnOffer && deps.offers.isLive(offer.claim.token);
  if (isOwnOffer && !tokenLive) return null;

  return {
    hostname: isOwnOffer ? (offer.hostname ?? null) : null,
    canPairThisBrowser: tokenLive,
  };
}

export function createPairingCodeHandler(
  deps: PairingCodeRouteDependencies,
  readCode: (req: express.Request) => string | undefined,
): RequestHandler {
  return (req, res) => {
    void (async () => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const code = readCode(req)?.trim();
      const resolved = code ? resolvePairingCode(code, deps) : null;
      if (!code || !resolved) {
        res.status(404).send(renderExpiredPairingPage());
        return;
      }
      const url = `${deps.pairingBaseUrl().replace(/\/+$/, "")}/code/${code}`;
      res.status(200).send(
        renderPairingCodePage({
          code,
          hostname: resolved.hostname,
          qrSvg: await renderPairingQrSvg(url),
          canPairThisBrowser: resolved.canPairThisBrowser,
        }),
      );
    })();
  };
}

export function mountPairingCodeRoutes(
  app: express.Application,
  deps: PairingCodeRouteDependencies,
): void {
  app.get(
    "/code/:code",
    createPairingCodeHandler(deps, (req) => {
      const value = (req.params as Record<string, string | undefined>).code;
      return typeof value === "string" ? value : undefined;
    }),
  );
  app.get(
    "/pair",
    createPairingCodeHandler(deps, (req) => {
      const value = req.query.code;
      return typeof value === "string" ? value : undefined;
    }),
  );
}
