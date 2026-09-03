/**
 * Entry point for the standalone pairing-page service (pair-page-server.ts).
 *
 * Run it directly (`node dist/server/server/pair-page-cli.js`) or from the
 * bundled image in `deploy/pair`. It holds no state, so it can be restarted,
 * scaled, or moved between hosts freely.
 */
import { createPairPageApp, DEFAULT_PAIR_PAGE_ROOT_REDIRECT } from "./pair-page-server.js";

import { DEFAULT_PAIRING_BASE_URL } from "@fde/protocol/connection-offer";

const host = process.env.FDE_PAIR_HOST ?? "0.0.0.0";
const port = Number(process.env.FDE_PAIR_PORT ?? 8787);
const pairingBaseUrl = process.env.FDE_PAIRING_BASE_URL ?? DEFAULT_PAIRING_BASE_URL;
const rootRedirect = process.env.FDE_PAIR_ROOT_REDIRECT ?? DEFAULT_PAIR_PAGE_ROOT_REDIRECT;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[fde-pair-page] invalid FDE_PAIR_PORT: ${process.env.FDE_PAIR_PORT}`);
  process.exit(1);
}

const server = createPairPageApp({ pairingBaseUrl, rootRedirect }).listen(port, host, () => {
  console.log(`[fde-pair-page] listening on http://${host}:${port} for ${pairingBaseUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Don't let a hung keep-alive connection block the shutdown.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
