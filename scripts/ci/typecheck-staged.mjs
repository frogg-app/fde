// Typecheck only the workspaces that contain staged files. The full root typecheck takes
// minutes on a laptop; this keeps the pre-commit hook proportional to the change.
import { spawnSync } from "node:child_process";
import { hasScript, repoRoot, stagedFiles, workspacesFor } from "./changed-files.mjs";

const sources = stagedFiles().filter((file) => /\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/u.test(file));
const workspaces = [...workspacesFor(sources)].filter((name) => hasScript(name, "typecheck"));

if (workspaces.length === 0) {
  console.log("typecheck-staged: no workspace sources staged, skipping");
  process.exit(0);
}

for (const name of workspaces) {
  console.log(`typecheck-staged: ${name}`);
  const result = spawnSync("npm", ["run", "typecheck", "--workspace", name], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
