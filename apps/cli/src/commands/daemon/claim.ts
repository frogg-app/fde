import type { Command } from "commander";
import { createClaimStore, loadPersistedConfig, type DaemonIdentity } from "@fde/server";

import type {
  CommandOptions,
  OutputOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { daemonHttpJson, resolveLoopbackHttpBase } from "./daemon-http.js";
import { resolveLocalDaemonState, resolveLocalPaseoHome } from "./local-daemon.js";

/**
 * `fde daemon claim-status` and `fde daemon reset-claim`: inspect or clear the
 * paired principals under $PASEO_HOME (see docs/permissions.md, "Claimed state").
 * Both work on the files directly, so they do not need a running daemon; the
 * daemon re-reads the principals file on every check, so a reset takes effect
 * live and the pairing page comes back for LAN visitors.
 */
interface ClaimPrincipalSummary {
  id: string;
  label: string;
  createdAt: string;
  credentials: number;
}

export interface ClaimStatusResult {
  home: string;
  principalsPath: string;
  claimed: boolean;
  claimedAt: string | null;
  passwordConfigured: boolean;
  /** True when a LAN client must pair (or use a password) before it can connect. */
  pairingRequired: boolean;
  principals: ClaimPrincipalSummary[];
  daemon:
    | { reachable: true; listen: string | null; pairingRequired: boolean }
    | { reachable: false };
}

export interface ResetClaimResult {
  action: "claim_reset" | "not_claimed";
  home: string;
  principalsPath: string;
  removedPrincipals: number;
  message: string;
}

const claimStatusSchema: OutputSchema<ClaimStatusResult> = {
  idField: (result) => (result.claimed ? "claimed" : "unclaimed"),
  columns: [
    { header: "CLAIMED", field: (result) => (result.claimed ? "yes" : "no") },
    { header: "PRINCIPALS", field: (result) => String(result.principals.length) },
    { header: "PASSWORD", field: (result) => (result.passwordConfigured ? "yes" : "no") },
    { header: "HOME", field: "home" },
  ],
  renderHuman: (result, options: OutputOptions) => {
    const data = result.data as ClaimStatusResult;
    if (options.format !== "table") return JSON.stringify(data);
    const lines = [
      `Claimed:        ${data.claimed ? `yes (${data.claimedAt ?? "unknown time"})` : "no"}`,
      `Password:       ${data.passwordConfigured ? "configured" : "not configured"}`,
      `Pairing needed: ${data.pairingRequired ? "yes, for clients beyond loopback" : "no"}`,
      `Principals:     ${data.principalsPath}`,
      `Daemon:         ${
        data.daemon.reachable
          ? `reachable at ${data.daemon.listen ?? "?"} (pairingRequired=${data.daemon.pairingRequired})`
          : "not reachable over HTTP"
      }`,
    ];
    for (const principal of data.principals) {
      lines.push(
        `  - ${principal.label} (${principal.id}, ${principal.credentials} credential${principal.credentials === 1 ? "" : "s"}, ${principal.createdAt})`,
      );
    }
    return lines.join("\n");
  },
};

const resetClaimSchema: OutputSchema<ResetClaimResult> = {
  idField: "action",
  columns: [
    { header: "STATUS", field: "action", color: () => "green" },
    { header: "REMOVED", field: (result) => String(result.removedPrincipals) },
    { header: "PRINCIPALS", field: "principalsPath" },
  ],
  renderHuman: (result, options: OutputOptions) => {
    const data = result.data as ResetClaimResult;
    return options.format === "table" ? data.message : JSON.stringify(data);
  },
};

async function probeDaemonIdentity(listen: string): Promise<ClaimStatusResult["daemon"]> {
  const base = resolveLoopbackHttpBase(listen);
  if (!base) return { reachable: false };
  try {
    const identity = await daemonHttpJson<DaemonIdentity>({ base, path: "/api/identity" });
    return { reachable: true, listen: identity.listen, pairingRequired: identity.pairingRequired };
  } catch {
    return { reachable: false };
  }
}

export async function describeClaimStatus(home?: string): Promise<ClaimStatusResult> {
  const paseoHome = resolveLocalPaseoHome(home);
  const store = createClaimStore(paseoHome);
  const file = store.read();
  const passwordConfigured = Boolean(loadPersistedConfig(paseoHome).daemon?.auth?.password);
  const claimed = store.isClaimed();
  const state = resolveLocalDaemonState({ home });
  return {
    home: paseoHome,
    principalsPath: store.filePath,
    claimed,
    claimedAt: file.claimedAt ?? null,
    passwordConfigured,
    pairingRequired: !claimed && !passwordConfigured,
    principals: file.principals.map((principal) => ({
      id: principal.id,
      label: principal.label,
      createdAt: principal.createdAt,
      credentials: principal.credentials.length,
    })),
    daemon: state.running ? await probeDaemonIdentity(state.listen) : { reachable: false },
  };
}

export function resetClaim(home?: string): ResetClaimResult {
  const paseoHome = resolveLocalPaseoHome(home);
  const store = createClaimStore(paseoHome);
  const removedPrincipals = store.read().principals.length;
  const existed = store.reset();
  return {
    action: existed ? "claim_reset" : "not_claimed",
    home: paseoHome,
    principalsPath: store.filePath,
    removedPrincipals,
    message: existed
      ? `Removed ${removedPrincipals} paired principal${removedPrincipals === 1 ? "" : "s"} (${store.filePath}). Paired devices lose access; the next LAN visitor sees the pairing page.`
      : `Nothing to reset: no paired principals at ${store.filePath}.`,
  };
}

export async function runClaimStatusCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ClaimStatusResult>> {
  const home = typeof options.home === "string" ? options.home : undefined;
  return { type: "single", data: await describeClaimStatus(home), schema: claimStatusSchema };
}

export async function runResetClaimCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ResetClaimResult>> {
  const home = typeof options.home === "string" ? options.home : undefined;
  return { type: "single", data: resetClaim(home), schema: resetClaimSchema };
}
