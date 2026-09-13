import { portableCommand } from "./npm-command.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { prepareBrand } from "./branding/prepare.mjs";
import { root } from "./branding/resolve.mjs";
const { brand } = await prepareBrand();
const project =
  process.env.FROGG_WEB_DEPLOY_PROJECT ?? (brand.legacyFrogg ? "frogg-app" : undefined);
if (!project || !/^[a-z0-9][a-z0-9-]*$/.test(project)) {
  throw new Error(
    "Set FROGG_WEB_DEPLOY_PROJECT to this product's Cloudflare Pages project before deployment.",
  );
}
function npm(args: string[]) {
  const invocation = portableCommand("npm", args);
  execFileSync(invocation.command, invocation.args, options);
}
const options = { cwd: root, stdio: "inherit" as const, shell: false };
npm(["run", "build:ui"]);
npm([
  "exec",
  "--",
  "wrangler",
  "pages",
  "deploy",
  path.join(root, "apps/ui/dist"),
  "--project-name",
  project,
  "--branch",
  "main",
]);
