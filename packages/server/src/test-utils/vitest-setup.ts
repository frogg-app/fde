import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load package-local .env.test first for integration/E2E credentials, then repo-root .env fallback.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.resolve(serverRoot, ".env.test"), override: true });
dotenv.config({ path: path.resolve(serverRoot, "../.env") });

// Every worker gets its own throwaway home. Without this, any code path that resolves the
// default home (`~/.fde`) reads and writes the developer's real state — and with 20 workers
// sharing it, tests corrupt each other and can disturb a running daemon.
if (!process.env.FDE_HOME && !process.env.PASEO_HOME) {
  const workerHome = path.join(
    os.tmpdir(),
    `fde-test-home-${process.pid}-${process.env.VITEST_WORKER_ID ?? "0"}`,
  );
  mkdirSync(workerHome, { recursive: true, mode: 0o700 });
  process.env.FDE_HOME = workerHome;
  process.env.PASEO_HOME = workerHome;
}

process.env.PASEO_SUPERVISED = "0";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_SSH_COMMAND = "ssh -oBatchMode=yes";
process.env.SSH_ASKPASS = "/usr/bin/false";
process.env.SSH_ASKPASS_REQUIRE = "force";
process.env.DISPLAY = process.env.DISPLAY ?? "1";
