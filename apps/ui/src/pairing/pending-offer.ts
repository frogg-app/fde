import { extractPairingCode, hasOfferFragment } from "@fde/protocol/connection-offer";

/**
 * A pairing link that arrived from outside the app (web URL, native
 * `Linking`, desktop deep link) waits here until the `/pair-offer` screen
 * picks it up. Kept in memory only: the payload carries a single-use claim
 * token and must not be persisted or put in a route parameter.
 */
let pendingOfferUrl: string | null = null;
const listeners = new Set<() => void>();

export function setPendingOfferUrl(url: string): void {
  pendingOfferUrl = url;
  for (const listener of listeners) listener();
}

export function takePendingOfferUrl(): string | null {
  const url = pendingOfferUrl;
  pendingOfferUrl = null;
  return url;
}

export function peekPendingOfferUrl(): string | null {
  return pendingOfferUrl;
}

export function subscribePendingOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Normalises the ways a pairing link reaches the app: the canonical
 * `https://pair.frogg.app/code/<code>`, the `?code=` query, the older
 * `…#offer=<payload>` fragment (including `paseo://pair#offer=…`), and the
 * `?offer=` query the web build also accepts. Returns a string carrying an
 * `#offer=` fragment, or null when the URL carries no offer.
 */
export function extractOfferLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (hasOfferFragment(trimmed)) return trimmed;
  const code = extractPairingCode(trimmed) ?? extractOfferQueryParam(trimmed);
  return code ? `#offer=${code}` : null;
}

function extractOfferQueryParam(input: string): string | null {
  const queryIndex = input.indexOf("?");
  if (queryIndex === -1) return null;
  const hashIndex = input.indexOf("#", queryIndex);
  const query = input.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
  const encoded = new URLSearchParams(query).get("offer")?.trim();
  return encoded ? encoded : null;
}
