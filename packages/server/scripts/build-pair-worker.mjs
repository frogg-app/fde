/**
 * Bundles the pairing page into a single ES module for Cloudflare Workers
 * (dist/pair-worker/worker.mjs), so `wrangler deploy` needs no monorepo
 * install and no node_modules on the deploying machine.
 *
 * The companion of build-pair-page.mjs: same sources, same render path, a
 * different transport. Anything that changes what a visitor sees lives in the
 * shared modules, so the Worker and the daemon's own page cannot drift.
 */
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const protocolSrc = here("../../protocol/src/");

/** `@fde/protocol/x` resolves to the workspace source, with no install step. */
const protocolSourcePlugin = {
  name: "fde-protocol-source",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@fde\/protocol\// }, (args) => ({
      path: `${protocolSrc}${args.path.slice("@fde/protocol/".length)}.ts`,
    }));
  },
};

const result = await build({
  entryPoints: [here("../src/server/pair-page-worker.ts")],
  outfile: here("../dist/pair-worker/worker.mjs"),
  bundle: true,
  // `browser` keeps esbuild from resolving Node built-ins into the bundle; the
  // handful `qrcode` reaches for come from the Worker runtime's nodejs_compat.
  platform: "browser",
  format: "esm",
  target: "es2022",
  conditions: ["workerd", "worker", "browser", "import"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  plugins: [protocolSourcePlugin],
});

const bytes = Object.values(result.metafile.outputs).find((o) => o.bytes)?.bytes ?? 0;
console.log(`[pair-worker] bundled ${(bytes / 1024).toFixed(0)} KiB`);
