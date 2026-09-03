import express, { type RequestHandler } from "express";
import type { Logger } from "pino";
import { z } from "zod";

import type { ClaimStore } from "./claim-store.js";
import {
  buildDirectClaimOffer,
  renderClaimOfferQrSvg,
  type ClaimOfferSource,
} from "./claim-offer.js";
import { renderPairingQr } from "./pairing-qr.js";

/**
 * First-run pairing routes.
 *
 * - `GET  /api/setup/status`  public: `{ claimed, pairingRequired }` for the gate page to poll
 * - `POST /api/setup/claim`   public: redeems a claim token, mints the first (or another)
 *                             principal + device credential, and marks the daemon claimed
 * - `POST /api/setup/offer`   behind the normal bearer policy: issues a fresh direct offer
 *                             (loopback CLI, or an already-paired client adding a device)
 */
const ClaimRequestSchema = z
  .object({
    token: z.string().min(1),
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const OfferRequestSchema = z.object({ qr: z.enum(["svg", "terminal"]).optional() }).optional();

export interface SetupRouteDependencies {
  claimStore: ClaimStore;
  offerSource: ClaimOfferSource;
  hasPassword: () => boolean;
  onClaimed?: (input: { principalId: string; label: string }) => void;
  logger: Logger;
}

export function createSetupStatusHandler(deps: SetupRouteDependencies): RequestHandler {
  return (_req, res) => {
    const claimed = deps.claimStore.isClaimed() || deps.hasPassword();
    res.setHeader("Cache-Control", "no-store");
    res.json({ claimed, pairingRequired: !claimed });
  };
}

export function createSetupClaimHandler(deps: SetupRouteDependencies): RequestHandler {
  return (req, res) => {
    const parsed = ClaimRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid claim request" });
      return;
    }
    if (!deps.offerSource.offers.consume(parsed.data.token)) {
      deps.logger.warn("Rejected pairing claim with an unknown, used, or expired token");
      res.status(403).json({ error: "Invalid or expired claim token" });
      return;
    }
    const label = parsed.data.label ?? "Paired device";
    const minted = deps.claimStore.mintPrincipal({ label });
    deps.logger.info({ principalId: minted.principalId, label }, "Device paired; daemon claimed");
    deps.onClaimed?.({ principalId: minted.principalId, label });
    res.status(201).json({
      serverId: deps.offerSource.serverId,
      principalId: minted.principalId,
      credentialId: minted.credentialId,
      credential: minted.credential,
      permissions: minted.permissions,
    });
  };
}

export function createSetupOfferHandler(deps: SetupRouteDependencies): RequestHandler {
  return (req, res) => {
    void (async () => {
      const parsed = OfferRequestSchema.safeParse(req.body);
      const qrMode = parsed.success ? parsed.data?.qr : undefined;
      const requestHost = typeof req.headers.host === "string" ? req.headers.host : undefined;
      let built;
      try {
        built = buildDirectClaimOffer(deps.offerSource, {
          requestHost,
          useTls: req.protocol === "https",
        });
      } catch (error) {
        res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const qr =
        qrMode === "svg"
          ? await renderClaimOfferQrSvg(built.url)
          : qrMode === "terminal"
            ? await renderPairingQr(built.url).catch(() => null)
            : null;
      res.setHeader("Cache-Control", "no-store");
      res.json({
        url: built.url,
        expiresAt: built.expiresAt,
        endpoints: built.endpoints,
        claimed: deps.claimStore.isClaimed() || deps.hasPassword(),
        qr,
      });
    })();
  };
}

export function mountSetupRoutes(app: express.Application, deps: SetupRouteDependencies): void {
  app.get("/api/setup/status", createSetupStatusHandler(deps));
  app.post("/api/setup/claim", express.json({ limit: "8kb" }), createSetupClaimHandler(deps));
  app.post("/api/setup/offer", express.json({ limit: "8kb" }), createSetupOfferHandler(deps));
}
