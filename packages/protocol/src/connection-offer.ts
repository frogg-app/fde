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
const PAIRING_CODE_PATH = "/code/";

/**
 * Where FDE pairing links point: `https://pair.frogg.app/code/<code>`, where
 * the code is the offer payload as URL-safe base64. The owner can point that
 * hostname at their own daemon, which serves the same landing page from
 * `GET /code/:code`. This is the daemon's default `app.pairingBaseUrl`.
 */
export const DEFAULT_PAIRING_BASE_URL = "https://pair.frogg.app";

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
 * Joins a pairing base URL and an encoded offer into `<base>/code/<code>`. A
 * base that already ends in `/code` is not doubled up.
 */
export function buildPairingUrl(baseUrl: string, encoded: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/code")) return `${base}/${encoded}`;
  return `${base}${PAIRING_CODE_PATH}${encoded}`;
}

/** `paseo://pair#offer=<payload>` for any link or code carrying an offer; null without one. */
export function buildPairingDeepLink(offerUrlOrFragment: string): string | null {
  const encoded = extractPairingCode(offerUrlOrFragment);
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

/** True when the input carries a pairing payload in any accepted form. */
export function hasPairingCode(input: string): boolean {
  return extractPairingCode(input) !== null;
}

const CODE_CHARS = /^[A-Za-z0-9_-]+$/;

function extractOfferFragmentEncoded(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1) return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}

function extractCodeQueryParam(input: string): string | null {
  const queryIndex = input.indexOf("?");
  if (queryIndex === -1) return null;
  const hashIndex = input.indexOf("#", queryIndex);
  const query = input.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
  const code = new URLSearchParams(query).get("code")?.trim();
  return code ? code : null;
}

function extractCodePathSegment(input: string): string | null {
  const withoutFragment = input.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  const codeIndex = withoutQuery.lastIndexOf(PAIRING_CODE_PATH);
  if (codeIndex === -1) return null;
  const code = withoutQuery.slice(codeIndex + PAIRING_CODE_PATH.length).replace(/\/+$/, "").trim();
  return code.length > 0 && CODE_CHARS.test(code) ? code : null;
}

/**
 * The encoded offer from any link FDE hands out: the canonical
 * `https://pair.frogg.app/code/<code>`, the older `…#offer=<code>` fragment
 * (still emitted as the `paseo://pair` deep link), and `…?code=<code>`.
 * Returns null when the input carries no payload.
 */
export function extractPairingCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return (
    extractOfferFragmentEncoded(trimmed) ??
    extractCodeQueryParam(trimmed) ??
    extractCodePathSegment(trimmed)
  );
}

/**
 * Parse a pairing link in any accepted form: `https://pair.frogg.app/code/<code>`,
 * `…?code=<code>`, or the older `…#offer=<base64url>` fragment (including
 * `paseo://pair#offer=…` and Paseo's `https://app.paseo.sh/#offer=…`).
 *
 * Returns `null` if the input carries no pairing code. Throws if a code exists
 * but the payload is malformed or fails schema validation.
 */
export function parseConnectionOfferFromUrl(input: string): ConnectionOffer | null {
  const encoded = extractPairingCode(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return ConnectionOfferSchema.parse(payload);
}

/**
 * Like `parseConnectionOfferFromUrl` but accepts both the relay-only v2 offer
 * and the direct claim v3 offer.
 */
export function parseAnyConnectionOfferFromUrl(input: string): AnyConnectionOffer | null {
  const encoded = extractPairingCode(input);
  if (!encoded) return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return AnyConnectionOfferSchema.parse(payload);
}
