#!/usr/bin/env npx tsx

import assert from "node:assert";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

console.log("=== Onboarding Command ===\n");

const paseoHome = await mkdtemp(join(tmpdir(), "paseo-onboard-home-"));
const port = await getAvailablePort();

try {
  console.log("Test 1: `paseo` runs blocking onboarding without implicit relay pairing");
  // Voice is on by default (and would download speech models); opt out to keep the test hermetic.
  const onboard =
    await $`PASEO_HOME=${paseoHome} PASEO_LISTEN=127.0.0.1:${port} PASEO_VOICE=0 npx paseo`.nothrow();

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
    !onboard.stdout.includes("relay.paseo.sh"),
    "onboard output should not include a relay pairing offer",
  );
  assert(
    onboard.stdout.includes("CLI quick reference"),
    "onboard output should include CLI quick reference",
  );
  assert(onboard.stdout.includes("paseo --help"), "onboard output should include --help shortcut");
  assert(onboard.stdout.includes("paseo ls"), "onboard output should include ls shortcut");
  assert(
    onboard.stdout.includes('paseo run "your prompt"'),
    "onboard output should include run shortcut",
  );
  assert(onboard.stdout.includes("paseo status"), "onboard output should include status shortcut");
  assert(
    onboard.stdout.includes(join(paseoHome, "daemon.log")),
    "onboard output should include daemon log path",
  );

  const status =
    await $`PASEO_HOME=${paseoHome} npx paseo daemon status --home ${paseoHome}`.nothrow();
  assert.strictEqual(status.exitCode, 0, `daemon status should succeed: ${status.stderr}`);
  assert(status.stdout.includes("running"), "daemon should be running when onboarding exits");
  console.log("✓ onboarding keeps relay disabled and waits for daemon readiness\n");

  console.log("Test 2: --no-relay suppresses pairing for an already-running daemon");
  const enableRelay =
    await $`PASEO_HOME=${paseoHome} npx paseo daemon pair --home ${paseoHome} --relay`.nothrow();
  assert.strictEqual(enableRelay.exitCode, 0, `relay enable should succeed: ${enableRelay.stderr}`);
  assert(enableRelay.stdout.includes("#offer="), "relay enable should produce a pairing offer");

  const noRelayOnboard =
    await $`PASEO_HOME=${paseoHome} PASEO_LISTEN=127.0.0.1:${port} npx paseo --no-relay`.nothrow();
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

  console.log("Test 3: PASEO_VOICE=0 persists the voice opt-out in config");
  const configRaw = await readFile(join(paseoHome, "config.json"), "utf-8");
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
  const daemonLog = await readFile(join(paseoHome, "daemon.log"), "utf-8");
  assert(
    !daemonLog.includes("Ensuring local speech models"),
    "daemon should not attempt local speech model setup when voice is disabled",
  );
  console.log("✓ PASEO_VOICE=0 persisted the voice opt-out\n");
} finally {
  await $`PASEO_HOME=${paseoHome} npx paseo daemon stop --home ${paseoHome} --force`.nothrow();
  await rm(paseoHome, { recursive: true, force: true });
}

console.log("=== Onboarding tests passed ===");
