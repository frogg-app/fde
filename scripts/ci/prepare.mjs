// npm `prepare` hook: install git hooks for local development only. CI runners and
// packaged installs set LEFTHOOK=0 (or CI=true) and must not depend on the lefthook
// platform binary being present.
import { spawnSync } from "node:child_process";

if (process.env.LEFTHOOK === "0" || process.env.CI === "true") {
  console.log("prepare: skipping lefthook install (LEFTHOOK=0 or CI)");
  process.exit(0);
}
const result = spawnSync("npx", ["--yes", "lefthook@2", "install", "--force"], {
  stdio: "inherit",
});
process.exit(result.status ?? 0);
