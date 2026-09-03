import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import chalk from "chalk";
import {
  generateLocalPairingOffer,
  getOrCreateServerId,
  loadConfig,
  resolvePaseoHome,
} from "@fde/server";
import { resolveDaemonPassword, tryConnectToDaemon } from "../../utils/client.js";
import { daemonHttpJson, resolveLoopbackHttpBase } from "./daemon-http.js";
import { resolveLocalDaemonState } from "./local-daemon.js";
import { addJsonOption } from "../../utils/command-options.js";
import { formatPairingInstructions } from "../../output/pairing.js";
import { buildPairingDeepLink } from "@fde/protocol/connection-offer";

interface PairOptions {
  home?: string;
  json?: boolean;
  relay?: boolean;
}

export interface PairCommandDependencies {
  resolveOffer: typeof resolveLocalPairingOffer;
  confirmRelay: typeof confirmRelayPairing;
  printDirectGuidance: typeof printDirectConnectionGuidance;
  isInteractive: () => boolean;
  output: PairCommandOutput;
}

export interface PairCommandOutput {
  columns: number | undefined;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  setExitCode(code: number): void;
  success(message: string): void;
}

export interface PairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
  /** `direct` offers carry a single-use claim token for LAN pairing; `relay` is the E2E relay offer. */
  mode?: "relay" | "direct";
  expiresAt?: string | null;
  endpoints?: string[];
}

interface DirectOfferResponse {
  url: string;
  expiresAt: string;
  endpoints: string[];
  qr: string | null;
}

const PAIRING_DAEMON_RPC_TIMEOUT_MS = 1500;
const RELAY_DOCS_URL = "https://paseo.sh/docs/security";

function createProcessOutput(): PairCommandOutput {
  return {
    columns: process.stdout.columns,
    writeStdout(message) {
      process.stdout.write(message);
    },
    writeStderr(message) {
      process.stderr.write(message);
    },
    setExitCode(code) {
      process.exitCode = code;
    },
    success(message) {
      log.success(message);
    },
  };
}

export function pairCommand(): Command {
  return addJsonOption(new Command("pair").description("Print the daemon pairing QR code and link"))
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .option("--relay", "Enable relay without prompting")
    .action(async (_options: PairOptions, command: Command) => {
      await runPairCommand(command.optsWithGlobals());
    });
}

export async function resolveLocalPairingOffer(options: {
  paseoHome: string;
  enableRelay?: boolean;
}): Promise<PairingOffer> {
  const state = resolveLocalDaemonState({ home: options.paseoHome });
  const serverId = getOrCreateServerId(state.home);
  const daemonOffer = await resolveDaemonPairingOffer(state.listen, serverId, options.enableRelay);
  if (daemonOffer) return daemonOffer;

  if (state.running) {
    throw new Error(
      "The running daemon did not provide a pairing offer. Check daemon connectivity or update the daemon.",
    );
  }

  const config = loadConfig(options.paseoHome);
  if (options.enableRelay && !config.relayEnabled) {
    throw new Error("Start the daemon before enabling relay for pairing.");
  }

  return generateLocalPairingOffer({
    paseoHome: options.paseoHome,
    relayEnabled: config.relayEnabled,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: true,
  });
}

async function resolveDaemonPairingOffer(
  listen: string,
  expectedServerId: string,
  enableRelay: boolean | undefined,
): Promise<PairingOffer | null> {
  const client = await tryConnectToDaemon({
    host: listen,
    timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
  });
  if (!client) return null;

  try {
    const serverInfo = client.getLastServerInfoMessage();
    if (serverInfo?.serverId.trim() !== expectedServerId) {
      throw new Error(
        "The reachable daemon belongs to a different Paseo home. Check --home or the daemon listen configuration.",
      );
    }
    if (serverInfo?.features?.daemonStatusRpc !== true) {
      throw new Error("Update the Paseo daemon before pairing from this command.");
    }

    let offer = await client.getDaemonPairingOffer({
      timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
    });
    if (!offer.relayEnabled && enableRelay) {
      if (serverInfo.features.relayConfig !== true) {
        throw new Error("Update the Paseo daemon before enabling relay from this command.");
      }
      await client.patchDaemonConfig({ relay: { enabled: true } });
      offer = await client.getDaemonPairingOffer({
        timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
      });
    }
    if (offer.relayEnabled) {
      return {
        relayEnabled: true,
        mode: "relay",
        url: offer.url || null,
        qr: offer.qr ?? null,
      };
    }
    // Relay off: pair over the LAN with a single-use direct claim offer instead.
    return (await resolveDirectClaimOffer(listen)) ?? { relayEnabled: false, url: null, qr: null };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function resolveDirectClaimOffer(listen: string): Promise<PairingOffer | null> {
  const base = resolveLoopbackHttpBase(listen);
  if (!base) return null;
  try {
    const direct = await daemonHttpJson<DirectOfferResponse>({
      base,
      path: "/api/setup/offer",
      method: "POST",
      body: { qr: "terminal" },
      bearer: resolveDaemonPassword(listen),
    });
    return {
      relayEnabled: false,
      mode: "direct",
      url: direct.url,
      qr: direct.qr,
      expiresAt: direct.expiresAt,
      endpoints: direct.endpoints,
    };
  } catch {
    return null;
  }
}

export async function confirmRelayPairing(): Promise<boolean> {
  log.message("Your connection is end-to-end encrypted. Paseo cannot read your code or messages.");
  log.message(`Learn how it works: ${RELAY_DOCS_URL}`);
  const answer = await confirm({
    message: "Enable relay to pair a device?",
    initialValue: false,
  });
  return !isCancel(answer) && answer;
}

export function printDirectConnectionGuidance(): void {
  console.log("Daemon is running with relay off.");
  console.log(
    "To connect another device directly, use the daemon's TCP address over your LAN, Tailscale, or another VPN.",
  );
  console.log(`Learn more: ${RELAY_DOCS_URL}#direct-connections`);
}

export async function runPairCommand(
  options: PairOptions,
  dependencyOverrides: Partial<PairCommandDependencies> = {},
): Promise<void> {
  if (options.home) process.env.FDE_HOME = options.home;
  const dependencies: PairCommandDependencies = {
    resolveOffer: resolveLocalPairingOffer,
    confirmRelay: confirmRelayPairing,
    printDirectGuidance: printDirectConnectionGuidance,
    isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    output: createProcessOutput(),
    ...dependencyOverrides,
  };

  const paseoHome = resolvePaseoHome();
  let pairing = await dependencies.resolveOffer({
    paseoHome,
    enableRelay: options.relay === true,
  });

  const canPrompt = dependencies.isInteractive() && options.json !== true;
  // A direct (LAN) offer needs no relay; only ask about relay when there is nothing to show.
  if (!pairing.relayEnabled && !pairing.url && canPrompt) {
    const shouldEnable = await dependencies.confirmRelay();
    if (!shouldEnable) {
      dependencies.printDirectGuidance();
      dependencies.output.writeStderr(`${chalk.yellow("No pairing QR was created.")}\n`);
      dependencies.output.setExitCode(1);
      return;
    }
    pairing = await dependencies.resolveOffer({ paseoHome, enableRelay: true });
    dependencies.output.success("Relay enabled");
  }

  outputPairingResult(pairing, options, dependencies.output);
}

function outputPairingResult(
  pairing: PairingOffer,
  options: PairOptions,
  output: PairCommandOutput,
): void {
  if (!pairing.url) {
    if (options.json) {
      output.writeStderr(
        `${JSON.stringify({
          code: "RELAY_DISABLED",
          message:
            "Relay pairing is disabled for this daemon and no direct offer is available (is the daemon running on TCP?).",
          action: "Run paseo daemon pair --relay --json to enable it explicitly.",
        })}\n`,
      );
    } else {
      output.writeStderr(`${chalk.red("Relay pairing is disabled for this daemon.")}\n`);
      output.writeStderr(`${chalk.yellow("Run paseo daemon pair --relay to enable it.")}\n`);
    }
    output.setExitCode(1);
    return;
  }

  const deepLink = buildPairingDeepLink(pairing.url);
  if (options.json) {
    output.writeStdout(
      `${JSON.stringify(
        {
          relayEnabled: pairing.relayEnabled,
          mode: pairing.mode ?? (pairing.relayEnabled ? "relay" : "direct"),
          url: pairing.url,
          deepLink,
          qr: pairing.qr,
          ...(pairing.expiresAt ? { expiresAt: pairing.expiresAt } : {}),
          ...(pairing.endpoints ? { endpoints: pairing.endpoints } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  output.writeStdout(
    formatPairingInstructions({
      url: pairing.url,
      qr: pairing.qr,
      columns: output.columns,
      deepLink,
    }),
  );
  if (pairing.mode === "direct") {
    output.writeStdout(
      `${chalk.dim(`Direct LAN pairing: this daemon has not been claimed yet; the first device to pair becomes its owner. Single-use, expires ${pairing.expiresAt ?? "soon"}. Reachable at ${(pairing.endpoints ?? []).join(", ")}.`)}\n`,
    );
  }
}
