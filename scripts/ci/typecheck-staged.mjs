// Typecheck only the workspaces that contain staged files. The full root typecheck takes
// minutes on a laptop; this keeps the pre-commit hook proportional to the change.
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const staged = execSync("git diff --cached --name-only --diff-filter=ACMR", { cwd: root })
  .toString()
  .split("\n")
  .filter((file) => /\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/u.test(file));

const workspaces = new Set();
for (const file of staged) {
  const match = /^(apps|packages)\/([^/]+)\//u.exec(file);
  if (!match) continue;
  const dir = path.join(root, match[1], match[2]);
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.scripts?.typecheck) workspaces.add(pkg.name);
}

if (workspaces.size === 0) {
  console.log("typecheck-staged: no workspace sources staged, skipping");
  process.exit(0);
}

for (const name of workspaces) {
  console.log(`typecheck-staged: ${name}`);
  const result = spawnSync("npm", ["run", "typecheck", "--workspace", name], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
