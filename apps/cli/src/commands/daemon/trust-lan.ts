import path from "node:path";
import type { Command } from "commander";
import {
  DEFAULT_TRUST_LAN,
  loadPersistedConfig,
  savePersistedConfig,
  type DaemonIdentity,
  type PersistedConfig,
} from "@fde/server";

import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";
import { daemonHttpJson, resolveLoopbackHttpBase } from "./daemon-http.js";
import { resolveLocalDaemonState, resolveLocalPaseoHome } from "./local-daemon.js";

/**
 * `fde daemon trust-lan on|off`: whether private-network clients (RFC 1918,
 * link-local, ULA) are treated like loopback, i.e. connect without pairing or
 * a password (docs/permissions.md, "Trusted LAN"). Writes
 * `daemon.auth.trustLan` to config.json and asks a running daemon to reload
 * it, so the change applies live; `PASEO_TRUST_LAN` on the daemon wins.
 */
const CONFIG_FILENAME = "config.json";
const TRUST_LAN_PATH = "daemon.auth.trustLan";
const LIVE_RELOAD_TIMEOUT_MS = 3000;

export type TrustLanMode = "on" | "off";

export type TrustLanApplied =
  | { status: "live" }
  | { status: "restart_required"; reason: string }
  | { status: "env_override" };

export interface TrustLanResult {
  action: "trust_lan_set";
  trustLan: boolean;
  configPath: string;
  applied: TrustLanApplied;
  message: string;
}

export interface TrustLanOptions {
  home?: string;
  /** Live apply through the daemon's config reload; injectable for tests. */
  reloadLive?: (listen: string) => Promise<TrustLanApplied>;
}

function createCommandError(code: string, message: string): CommandError {
  return { code, message };
}

export function parseTrustLanMode(value: unknown): TrustLanMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["on", "true", "1", "yes"].includes(normalized)) return "on";
  if (["off", "false", "0", "no"].includes(normalized)) return "off";
  throw createCommandError(
    "TRUST_LAN_MODE_INVALID",
    `Expected "on" or "off", got ${JSON.stringify(value)}`,
  );
}

async function reloadDaemonLive(listen: string): Promise<TrustLanApplied> {
  let client: Awaited<ReturnType<typeof connectToDaemon>>;
  try {
    client = await connectToDaemon({ host: listen, timeout: LIVE_RELOAD_TIMEOUT_MS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "restart_required", reason: `could not reach the daemon (${detail})` };
  }
  try {
    const reload = await client.reloadDaemonConfig();
    if (reload.overrideControlledPaths.includes(TRUST_LAN_PATH)) return { status: "env_override" };
    if (reload.restartRequiredPaths.includes(TRUST_LAN_PATH)) {
      return { status: "restart_required", reason: "this daemon cannot reload the setting" };
    }
    return { status: "live" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "restart_required", reason: `config reload failed (${detail})` };
  } finally {
    await client.close().catch(() => {});
  }
}

function describeApplied(trustLan: boolean, applied: TrustLanApplied): string {
  const mode = trustLan
    ? "Clients on your private network connect without pairing or a password (unless a password is set)."
    : "Clients on your private network must pair or use a password, like everyone beyond loopback.";
  switch (applied.status) {
    case "live":
      return `${mode}\nApplied to the running daemon.`;
    case "env_override":
      return `${mode}\nThe running daemon is controlled by PASEO_TRUST_LAN; unset it and restart for config.json to take effect.`;
    case "restart_required":
      return `${mode}\nRestart the daemon for the change to take effect (${applied.reason}).\nRun: fde daemon restart`;
  }
}

export async function setTrustLanInConfig(
  mode: TrustLanMode,
  options: TrustLanOptions = {},
): Promise<TrustLanResult> {
  const paseoHome = resolveLocalPaseoHome(options.home);
  const configPath = path.join(paseoHome, CONFIG_FILENAME);
  const trustLan = mode === "on";
  const persisted = loadPersistedConfig(paseoHome);
  const nextConfig: PersistedConfig = {
    ...persisted,
    daemon: {
      ...persisted.daemon,
      auth: { ...persisted.daemon?.auth, trustLan },
    },
  };
  savePersistedConfig(paseoHome, nextConfig);

  const state = resolveLocalDaemonState({ home: options.home });
  const applied: TrustLanApplied = state.running
    ? await (options.reloadLive ?? reloadDaemonLive)(state.listen)
    : { status: "restart_required", reason: "the daemon is not running; it applies on next start" };

  return {
    action: "trust_lan_set",
    trustLan,
    configPath,
    applied,
    message: `Trusted LAN ${trustLan ? "on" : "off"}: ${TRUST_LAN_PATH}=${trustLan} written to ${configPath}\n${describeApplied(trustLan, applied)}`,
  };
}

const trustLanResultSchema: OutputSchema<TrustLanResult> = {
  idField: "action",
  columns: [
    { header: "TRUST LAN", field: "trustLan" },
    { header: "CONFIG", field: "configPath" },
  ],
  renderHuman: (result) => (result.type === "single" ? result.data.message : ""),
};

export async function runTrustLanCommand(
  mode: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<TrustLanResult>> {
  const result = await setTrustLanInConfig(parseTrustLanMode(mode), {
    home: typeof options.home === "string" ? options.home : undefined,
  });
  return { type: "single", data: result, schema: trustLanResultSchema };
}

/**
 * The mode `fde daemon status` reports: the running daemon's answer when it
 * is reachable, otherwise what config.json (and this shell's PASEO_TRUST_LAN)
 * would give the next start.
 */
export async function resolveLanTrusted(input: {
  home?: string;
  running: boolean;
  listen: string;
}): Promise<boolean> {
  if (input.running) {
    const base = resolveLoopbackHttpBase(input.listen);
    if (base) {
      try {
        const identity = await daemonHttpJson<DaemonIdentity>({ base, path: "/api/identity" });
        if (typeof identity.lanTrusted === "boolean") return identity.lanTrusted;
      } catch {
        // Fall through to the persisted value.
      }
    }
  }
  const env = process.env.PASEO_TRUST_LAN?.trim().toLowerCase();
  if (env && ["1", "true", "yes", "on"].includes(env)) return true;
  if (env && ["0", "false", "no", "off"].includes(env)) return false;
  const paseoHome = resolveLocalPaseoHome(input.home);
  return loadPersistedConfig(paseoHome).daemon?.auth?.trustLan ?? DEFAULT_TRUST_LAN;
}
