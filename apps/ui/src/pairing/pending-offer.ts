import { hasOfferFragment } from "@fde/protocol/connection-offer";

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
 * Normalises the ways an offer reaches the app as a URL: the canonical
 * `…#offer=<payload>` fragment, the `?offer=<payload>` query the web build
 * also accepts, and `paseo://pair#offer=…`. Returns a string with an
 * `#offer=` fragment, or null when the URL carries no offer.
 */
export function extractOfferLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (hasOfferFragment(trimmed)) return trimmed;
  const queryIndex = trimmed.indexOf("?");
  if (queryIndex === -1) return null;
  const hashIndex = trimmed.indexOf("#", queryIndex);
  const query = trimmed.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
  const encoded = new URLSearchParams(query).get("offer")?.trim();
  return encoded ? `#offer=${encoded}` : null;
}
