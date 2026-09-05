/**
 * The pairing page as a Cloudflare Worker: the same service as
 * `pair-page-server.ts`, with `fetch` in place of express so it can run on the
 * edge with no host to operate.
 *
 * Everything that decides what a visitor sees is shared with the daemon's own
 * route — `resolvePairingCode` for the code, `renderPairingCodePage` and
 * `renderExpiredPairingPage` for the HTML, `CONTENT_SECURITY_POLICY` for the
 * headers — so this file is transport only. A pairing code carries the whole
 * offer in its URL, so there is still no state, no database, and no contact
 * with the daemon that issued it.
 *
 * As in the express service, the Worker issues no codes of its own: `serverId`
 * is a sentinel no offer can carry and the store is permanently empty, so every
 * code renders the hand-off page and none get the daemon-only "Pair this
 * browser" button.
 */
import { DEFAULT_PAIRING_BASE_URL } from "@fde/protocol/connection-offer";
import type { ClaimOfferStore } from "./claim-offer-store.js";
import { CONTENT_SECURITY_POLICY, DEFAULT_PAIR_PAGE_ROOT_REDIRECT } from "./pairing-page-chrome.js";
import { renderExpiredPairingPage, renderPairingCodePage } from "./pairing-code-page.js";
import { resolvePairingCode, type PairingCodeRouteDependencies } from "./pairing-code-route.js";
import { renderPairingQrSvg } from "./pairing-qr.js";

export interface PairPageWorkerEnv {
  /** Public base URL the rendered QR encodes. Must be the host people reach. */
  FDE_PAIRING_BASE_URL?: string;
  /** Where `GET /` sends a visitor who arrives without a code. */
  FDE_PAIR_ROOT_REDIRECT?: string;
}

/**
 * A sentinel `serverId`: offers carry a UUID, so this never matches and every
 * incoming code is treated as another daemon's.
 */
const FOREIGN_SERVER_ID = "pair-page-worker";

/** No codes are ever issued here, so nothing is ever live. */
const EMPTY_OFFER_STORE: ClaimOfferStore = {
  issue: () => {
    throw new Error("The pairing Worker issues no claim offers");
  },
  consume: () => false,
  isLive: () => false,
  liveCount: () => 0,
};

const BASE_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function html(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Reads the code from either shape of link the daemon hands out. */
function readCode(url: URL): string | undefined {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/pair") {
    const value = url.searchParams.get("code");
    return value ?? undefined;
  }
  const match = /^\/code\/(.+)$/.exec(path);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1];
  }
}

export async function handlePairPageRequest(
  request: Request,
  env: PairPageWorkerEnv = {},
): Promise<Response> {
  const pairingBaseUrl = env.FDE_PAIRING_BASE_URL ?? DEFAULT_PAIRING_BASE_URL;
  const rootRedirect = env.FDE_PAIR_ROOT_REDIRECT ?? DEFAULT_PAIR_PAGE_ROOT_REDIRECT;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // The pages are all GETs; anything else is not a browser following a link.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return html(renderExpiredPairingPage(), 405);
  }

  if (path === "/healthz") {
    return new Response(JSON.stringify({ ok: true, service: "fde-pair-page" }), {
      status: 200,
      headers: { ...BASE_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (path === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (path === "/") {
    return new Response(null, {
      status: 302,
      headers: { ...BASE_HEADERS, Location: rootRedirect },
    });
  }

  const deps: PairingCodeRouteDependencies = {
    serverId: FOREIGN_SERVER_ID,
    offers: EMPTY_OFFER_STORE,
    pairingBaseUrl: () => pairingBaseUrl,
  };

  const code = readCode(url)?.trim();
  const resolved = code ? resolvePairingCode(code, deps) : null;
  // Incurious like the daemon's route: one generic page for every miss,
  // including paths that are not pairing links at all.
  if (!code || !resolved) return html(renderExpiredPairingPage(), 404);

  const link = `${pairingBaseUrl.replace(/\/+$/, "")}/code/${code}`;
  return html(
    renderPairingCodePage({
      code,
      hostname: resolved.hostname,
      qrSvg: await renderPairingQrSvg(link),
      canPairThisBrowser: resolved.canPairThisBrowser,
    }),
    200,
  );
}

export default {
  fetch: handlePairPageRequest,
};
