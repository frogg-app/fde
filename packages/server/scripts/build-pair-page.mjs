/**
 * Bundles the standalone pairing-page service into one self-contained CJS file
 * (dist/pair-page/server.cjs) so the Docker image in deploy/pair needs nothing
 * but a Node runtime — no node_modules, no monorepo install.
 *
 * The bundle is built from the same sources the daemon uses, so the public page
 * and the page a daemon serves itself never drift.
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
  entryPoints: [here("../src/server/pair-page-cli.ts")],
  outfile: here("../dist/pair-page/server.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  plugins: [protocolSourcePlugin],
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`[pair-page] bundled ${(bytes / 1024).toFixed(0)} KiB`);
