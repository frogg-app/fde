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

/**
 * Where FDE pairing links point: `https://frogg.app/pair#offer=<payload>`. The
 * payload stays in the fragment, so the page host never receives it. This is
 * the daemon's default `app.baseUrl`.
 */
export const DEFAULT_PAIRING_BASE_URL = "https://frogg.app/pair";

/**
 * The same payload as an app deep link, `paseo://pair#offer=<payload>`. The
 * scheme stays `paseo` because the desktop shell already registers it.
 */
export const PAIRING_DEEP_LINK_SCHEME = "paseo";
export const PAIRING_DEEP_LINK_BASE = `${PAIRING_DEEP_LINK_SCHEME}://pair`;

function encodeUtf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function encodeOfferFragmentPayload(offer: AnyConnectionOffer): string {
  return encodeUtf8ToBase64Url(JSON.stringify(offer));
}

/**
 * Joins a base URL and an encoded offer. A bare origin keeps Paseo's
 * `https://host/#offer=` shape; a base with a path becomes `…/pair#offer=`.
 */
export function buildOfferFragmentUrl(baseUrl: string, encoded: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  let hasPath = false;
  try {
    hasPath = new URL(base).pathname.replace(/\/+$/, "").length > 0;
  } catch {
    hasPath = false;
  }
  return `${base}${hasPath ? "" : "/"}${OFFER_FRAGMENT_PREFIX}${encoded}`;
}

/** `paseo://pair#offer=<payload>` for any link or fragment carrying an offer; null without one. */
export function buildPairingDeepLink(offerUrlOrFragment: string): string | null {
  const encoded = extractOfferFragmentEncoded(offerUrlOrFragment);
  return encoded ? `${PAIRING_DEEP_LINK_BASE}${OFFER_FRAGMENT_PREFIX}${encoded}` : null;
}

/** True for `paseo://pair#offer=…` (a trailing slash before the fragment is tolerated). */
export function isPairingDeepLink(input: string): boolean {
  const trimmed = input.trim();
  return (
    (trimmed.startsWith(`${PAIRING_DEEP_LINK_BASE}#`) ||
      trimmed.startsWith(`${PAIRING_DEEP_LINK_BASE}/#`)) &&
    extractOfferFragmentEncoded(trimmed) !== null
  );
}

/** True when the input carries an `#offer=` fragment with a non-empty payload. */
export function hasOfferFragment(input: string): boolean {
  return extractOfferFragmentEncoded(input) !== null;
}

function extractOfferFragmentEncoded(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}

/**
 * Parse a pairing-offer URL of the form `https://frogg.app/pair#offer=<base64url>`
 * (or Paseo's `https://app.paseo.sh/#offer=…`, or `paseo://pair#offer=…`).
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
