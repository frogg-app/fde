/**
 * The standalone pairing-page service behind `https://pair.frogg.app`.
 *
 * It is the same `GET /code/:code` route the daemon serves (pairing-code-route.ts),
 * mounted on its own express app with no daemon behind it. Every pairing code
 * carries the whole offer in the URL, so rendering the page needs no state, no
 * database, and no contact with the daemon that issued the code: this service
 * decodes the code, renders the QR, the deep link and the raw code, and hands
 * the pairing itself to the FDE app.
 *
 * Because the service issues no codes of its own, `serverId` never matches an
 * incoming offer and the store is always empty, so every code renders the
 * hand-off page and none of them get the daemon-only "Pair this browser"
 * button. Anything that is not a live, unexpired offer renders the same
 * generic expired page.
 */
import { randomUUID } from "node:crypto";

import express from "express";

import { DEFAULT_PAIRING_BASE_URL } from "@fde/protocol/connection-offer";
import { createClaimOfferStore } from "./claim-offer-store.js";
import { CONTENT_SECURITY_POLICY, DEFAULT_PAIR_PAGE_ROOT_REDIRECT } from "./pairing-page-chrome.js";
import { renderExpiredPairingPage } from "./pairing-code-page.js";
import { mountPairingCodeRoutes } from "./pairing-code-route.js";

export { CONTENT_SECURITY_POLICY, DEFAULT_PAIR_PAGE_ROOT_REDIRECT };

export interface PairPageAppOptions {
  /** Base URL the rendered QR points back at. Default `https://pair.frogg.app`. */
  pairingBaseUrl?: string;
  /** Where `GET /` sends visitors who arrive without a code. */
  rootRedirect?: string;
}

export function createPairPageApp(options: PairPageAppOptions = {}): express.Express {
  const pairingBaseUrl = options.pairingBaseUrl ?? DEFAULT_PAIRING_BASE_URL;
  const rootRedirect = options.rootRedirect ?? DEFAULT_PAIR_PAGE_ROOT_REDIRECT;

  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, service: "fde-pair-page" });
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });

  app.get("/", (_req, res) => {
    res.redirect(302, rootRedirect);
  });

  mountPairingCodeRoutes(app, {
    // A random id no offer can carry: every code is another daemon's.
    serverId: `pair-page-${randomUUID()}`,
    offers: createClaimOfferStore(),
    pairingBaseUrl: () => pairingBaseUrl,
  });

  // Incurious like the pairing route itself: one generic page for everything.
  app.use((_req, res) => {
    res.status(404).type("text/html").send(renderExpiredPairingPage());
  });

  return app;
}
