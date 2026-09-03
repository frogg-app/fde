import { z } from "zod";

/**
 * Relay-only pairing offer.
 *
 * `serverId` is a stable daemon identifier scoped to `PASEO_HOME`, and is also
 * used as the relay session identifier.
 */
export const ConnectionOfferV2Schema = z.object({
  v: z.literal(2),
  serverId: z.string().min(1),
  daemonPublicKeyB64: z.string().min(1),
  relay: z.object({
    endpoint: z.string().min(1),
    useTls: z.boolean().optional(),
  }),
});

export type ConnectionOfferV2 = z.infer<typeof ConnectionOfferV2Schema>;

export const ConnectionOfferSchema = ConnectionOfferV2Schema;
export type ConnectionOffer = ConnectionOfferV2;

/**
 * Direct (LAN) claim offer, served by an unclaimed daemon's pairing page and by
 * `fde daemon pair` when relay is off. The client connects to one of
 * `direct.endpoints` over plain WebSocket, then redeems `claim.token` with
 * `POST /api/setup/claim` to mint its principal and device credential. The
 * token is single-use and expires at `claim.expiresAt`; `relay` is present only
 * when relay is enabled.
 */
export const ConnectionOfferV3Schema = z.object({
  v: z.literal(3),
  product: z.literal("fde").optional(),
  serverId: z.string().min(1),
  hostname: z.string().optional(),
  daemonPublicKeyB64: z.string().min(1),
  direct: z.object({
    endpoints: z.array(z.string().min(1)).min(1),
    useTls: z.boolean().optional(),
  }),
  claim: z.object({
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  }),
  relay: z
    .object({
      endpoint: z.string().min(1),
      useTls: z.boolean().optional(),
    })
    .optional(),
});

export type ConnectionOfferV3 = z.infer<typeof ConnectionOfferV3Schema>;

export const AnyConnectionOfferSchema = z.discriminatedUnion("v", [
  ConnectionOfferV2Schema,
  ConnectionOfferV3Schema,
]);
export type AnyConnectionOffer = z.infer<typeof AnyConnectionOfferSchema>;

function decodeBase64UrlToUtf8(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function decodeOfferFragmentPayload(encoded: string): unknown {
  const json = decodeBase64UrlToUtf8(encoded);
  return JSON.parse(json) as unknown;
}

const OFFER_FRAGMENT_PREFIX = "#offer=";

function extractOfferFragmentEncoded(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}

/**
 * Parse a pairing-offer URL of the form `https://app.paseo.sh/#offer=<base64url>`.
 *
 * Returns `null` if the input has no `#offer=` fragment. Throws if the fragment
 * exists but the payload is malformed or fails schema validation.
 */
export function parseConnectionOfferFromUrl(input: string): ConnectionOffer | null {
  const encoded = extractOfferFragmentEncoded(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return ConnectionOfferSchema.parse(payload);
}

/**
 * Like `parseConnectionOfferFromUrl` but accepts both the relay-only v2 offer
 * and the direct claim v3 offer.
 */
export function parseAnyConnectionOfferFromUrl(input: string): AnyConnectionOffer | null {
  const encoded = extractOfferFragmentEncoded(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return AnyConnectionOfferSchema.parse(payload);
}
