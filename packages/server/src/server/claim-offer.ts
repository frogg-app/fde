import * as QRCode from "qrcode";

import { ConnectionOfferV3Schema, type ConnectionOfferV3 } from "@fde/protocol/connection-offer";
import { buildOfferEndpoints, encodeOfferToFragmentUrl } from "./connection-offer.js";
import type { ClaimOfferStore } from "./claim-offer-store.js";
import type { ListenTarget } from "./bootstrap.js";

/**
 * Builds the direct (v3) claim offer the pairing page, `/api/setup/offer`, and
 * `fde daemon pair` hand to a client. The endpoints list starts with the
 * address the caller used to reach the daemon (the best guess for what the
 * client can reach too), then the daemon's own LAN/loopback endpoints.
 */
export interface ClaimOfferSource {
  serverId: string;
  hostname: string;
  daemonPublicKeyB64: string;
  appBaseUrl: () => string;
  listenTarget: () => ListenTarget | null;
  relay: () => { enabled: boolean; publicEndpoint: string; publicUseTls: boolean };
  offers: ClaimOfferStore;
}

export interface DirectClaimOffer {
  offer: ConnectionOfferV3;
  url: string;
  expiresAt: string;
  endpoints: string[];
}

export function buildDirectClaimOffer(
  source: ClaimOfferSource,
  options: { requestHost?: string; useTls?: boolean } = {},
): DirectClaimOffer {
  const listen = source.listenTarget();
  const endpoints: string[] = [];
  if (options.requestHost) endpoints.push(options.requestHost);
  if (listen?.type === "tcp") {
    endpoints.push(...buildOfferEndpoints({ listenHost: listen.host, port: listen.port }));
  }
  const uniqueEndpoints = Array.from(new Set(endpoints));
  if (uniqueEndpoints.length === 0) {
    throw new Error("The daemon has no TCP endpoint to pair against");
  }
  const claim = source.offers.issue();
  const relay = source.relay();
  const offer = ConnectionOfferV3Schema.parse({
    v: 3,
    product: "fde",
    serverId: source.serverId,
    hostname: source.hostname,
    daemonPublicKeyB64: source.daemonPublicKeyB64,
    direct: { endpoints: uniqueEndpoints, ...(options.useTls ? { useTls: true } : {}) },
    claim,
    ...(relay.enabled
      ? { relay: { endpoint: relay.publicEndpoint, useTls: relay.publicUseTls } }
      : {}),
  });
  return {
    offer,
    url: encodeOfferToFragmentUrl({ offer, appBaseUrl: source.appBaseUrl() }),
    expiresAt: claim.expiresAt,
    endpoints: uniqueEndpoints,
  };
}

export async function renderClaimOfferQrSvg(url: string): Promise<string | null> {
  try {
    return await QRCode.toString(url, { type: "svg", margin: 1 });
  } catch {
    return null;
  }
}
