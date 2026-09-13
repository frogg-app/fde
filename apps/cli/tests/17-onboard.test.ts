#!/usr/bin/env npx tsx

import assert from "node:assert";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

console.log("=== Onboarding Command ===\n");

const froggHome = await mkdtemp(join(tmpdir(), "frogg-onboard-home-"));
const port = await getAvailablePort();

try {
  console.log("Test 1: `frogg` runs blocking onboarding without implicit relay pairing");
  // Voice is on by default (and would download speech models); opt out to keep the test hermetic.
  const onboard =
    await $`FROGG_HOME=${froggHome} FROGG_LISTEN=127.0.0.1:${port} FROGG_VOICE=0 npx frogg`.nothrow();

  assert.strictEqual(
    onboard.exitCode,
    0,
    `onboard should succeed:\nstdout:\n${onboard.stdout}\nstderr:\n${onboard.stderr}`,
  );
  // Relay stays off; the daemon hands out a direct (LAN) claim offer instead of a relay one.
  assert(
    onboard.stdout.includes("Daemon is running with relay off"),
    "onboard output should explain the direct connection path",
  );
  const offerMatch = onboard.stdout.match(/#offer=([A-Za-z0-9_-]+)/);
  assert(offerMatch?.[1], "onboard output should include a pairing offer");
  const offerPayload = JSON.parse(Buffer.from(offerMatch[1], "base64url").toString("utf8")) as {
    v?: number;
    direct?: { endpoints?: string[] };
  };
  assert.strictEqual(offerPayload.v, 3, "the offer should be a direct (v3) claim offer");
  assert(
    offerPayload.direct?.endpoints?.includes(`127.0.0.1:${port}`),
    "the direct offer should list the daemon endpoint",
  );
  assert(
    !onboard.stdout.includes("relay.example.test"),
    "onboard output should not include a relay pairing offer",
  );
  assert(
    onboard.stdout.includes("CLI quick reference"),
    "onboard output should include CLI quick reference",
  );
  assert(onboard.stdout.includes("frogg --help"), "onboard output should include --help shortcut");
  assert(onboard.stdout.includes("frogg ls"), "onboard output should include ls shortcut");
  assert(
    onboard.stdout.includes('frogg run "your prompt"'),
    "onboard output should include run shortcut",
  );
  assert(onboard.stdout.includes("frogg status"), "onboard output should include status shortcut");
  assert(
    onboard.stdout.includes(join(froggHome, "daemon.log")),
    "onboard output should include daemon log path",
  );
  assert(
    onboard.stdout.includes("https://pair.frogg.app/code/"),
    "onboard output should print the pairing link as a pair.frogg.app code URL",
  );
  assert(
    onboard.stdout.includes("Access: "),
    "onboard output should state who can connect right now",
  );
  assert(
    onboard.stdout.includes(`Frogg home: ${froggHome}`),
    "onboard output should print the Frogg home in use",
  );

  const status =
    await $`FROGG_HOME=${froggHome} npx frogg daemon status --home ${froggHome}`.nothrow();
  assert.strictEqual(status.exitCode, 0, `daemon status should succeed: ${status.stderr}`);
  assert(status.stdout.includes("running"), "daemon should be running when onboarding exits");
  console.log("✓ onboarding keeps relay disabled and waits for daemon readiness\n");

  console.log("Test 2: --no-relay suppresses pairing for an already-running daemon");
  const enableRelay =
    await $`FROGG_HOME=${froggHome} npx frogg daemon pair --home ${froggHome} --relay`.nothrow();
  assert.strictEqual(enableRelay.exitCode, 0, `relay enable should succeed: ${enableRelay.stderr}`);
  assert(enableRelay.stdout.includes("#offer="), "relay enable should produce a pairing offer");

  const noRelayOnboard =
    await $`FROGG_HOME=${froggHome} FROGG_LISTEN=127.0.0.1:${port} npx frogg --no-relay`.nothrow();
  assert.strictEqual(
    noRelayOnboard.exitCode,
    0,
    `--no-relay onboarding should succeed: ${noRelayOnboard.stderr}`,
  );
  assert(
    !noRelayOnboard.stdout.includes("#offer="),
    "--no-relay onboarding should not include a pairing offer",
  );
  console.log("✓ --no-relay suppresses pairing for an already-running daemon\n");

  console.log("Test 3: FROGG_VOICE=0 persists the voice opt-out in config");
  const configRaw = await readFile(join(froggHome, "config.json"), "utf-8");
  const config = JSON.parse(configRaw) as {
    features?: {
      dictation?: { enabled?: boolean };
      voiceMode?: { enabled?: boolean };
    };
  };

  assert.strictEqual(
    config.features?.dictation?.enabled,
    false,
    "dictation.enabled should be false",
  );
  assert.strictEqual(
    config.features?.voiceMode?.enabled,
    false,
    "voiceMode.enabled should be false",
  );
  const daemonLog = await readFile(join(froggHome, "daemon.log"), "utf-8");
  assert(
    !daemonLog.includes("Ensuring local speech models"),
    "daemon should not attempt local speech model setup when voice is disabled",
  );
  console.log("✓ FROGG_VOICE=0 persisted the voice opt-out\n");
} finally {
  await $`FROGG_HOME=${froggHome} npx frogg daemon stop --home ${froggHome} --force`.nothrow();
  await rm(froggHome, { recursive: true, force: true });
}

console.log("=== Onboarding tests passed ===");
