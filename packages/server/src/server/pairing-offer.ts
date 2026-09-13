import { brand } from "@frogg/branding";
import type { Logger } from "pino";

import { createConnectionOfferV2, encodeOfferToPairingUrl } from "./connection-offer.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { renderPairingQr } from "./pairing-qr.js";
import { getOrCreateServerId } from "./server-id.js";

export interface LocalPairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
}

export async function generateLocalPairingOffer(args: {
  froggHome: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  appBaseUrl?: string;
  includeQr?: boolean;
  logger?: Logger;
}): Promise<LocalPairingOffer> {
  const relayEndpoint = args.relayEndpoint?.trim() ?? "";
  const relayPublicEndpoint = args.relayPublicEndpoint?.trim() || relayEndpoint;
  // Enabled without an endpoint is relay unavailable, not an error.
  const relayEnabled = (args.relayEnabled ?? true) && relayEndpoint.length > 0;
  if (!relayEnabled) {
    return {
      relayEnabled: false,
      url: null,
      qr: null,
    };
  }

  const relayUseTls = args.relayUseTls ?? true;
  const relayPublicUseTls = args.relayPublicUseTls ?? relayUseTls;
  const appBaseUrl = args.appBaseUrl ?? brand.services.pairingUrl ?? "";
  const serverId = getOrCreateServerId(args.froggHome, { logger: args.logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(args.froggHome, args.logger);
  const offer = await createConnectionOfferV2({
    serverId,
    daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
    relay: { endpoint: relayPublicEndpoint, useTls: relayPublicUseTls },
  });
  const url = encodeOfferToPairingUrl({ offer, appBaseUrl });

  if (args.includeQr === false) {
    return {
      relayEnabled: true,
      url,
      qr: null,
    };
  }

  let qr: string | null = null;
  try {
    qr = await renderPairingQr(url);
  } catch (error) {
    args.logger?.debug({ error }, "Failed to render pairing QR");
  }

  return {
    relayEnabled: true,
    url,
    qr,
  };
}
