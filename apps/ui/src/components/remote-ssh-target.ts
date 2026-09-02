import {
  DEFAULT_SSH_DAEMON_PORT,
  parseSshTransportUri,
  type SshTransportTarget,
} from "@fde/protocol/ssh-transport";
import { buildSshConfigHostTarget } from "@/desktop/ssh-config/ssh-config-hosts";

/** Which tab of the Remote SSH sheet the target comes from. */
export type RemoteSshMode = "config" | "manual";

export type RemoteSshFormError =
  | "hostRequired"
  | "invalidDaemonPort"
  | "targetRequired"
  | "invalidTarget";

export interface RemoteSshFormInput {
  mode: RemoteSshMode;
  /** SSH config tab: the highlighted `Host` alias. */
  selectedAlias: string | null;
  /** SSH config tab: the daemon port field as typed; blank means the default. */
  daemonPortText: string;
  /** Manual tab: the free-text `ssh://` URI. */
  manualTarget: string;
}

export type RemoteSshFormResult =
  | { ok: true; uri: string; target: SshTransportTarget }
  | { ok: false; error: RemoteSshFormError };

/** A blank field is the default port; anything else must be a whole port number. */
export function parseDaemonPortInput(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return DEFAULT_SSH_DAEMON_PORT;
  }
  if (!/^\d{1,5}$/u.test(trimmed)) {
    return null;
  }
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Turns the sheet's state into the `ssh://` URI the host store keys on plus
 * its parsed target. The config tab submits `ssh://<alias>` so `ssh` itself
 * resolves the alias (user, host name, port, identity, jump hosts); the
 * manual tab submits what was typed.
 */
export function resolveRemoteSshTarget(input: RemoteSshFormInput): RemoteSshFormResult {
  if (input.mode === "config") {
    const alias = input.selectedAlias?.trim() ?? "";
    if (!alias) {
      return { ok: false, error: "hostRequired" };
    }
    const daemonPort = parseDaemonPortInput(input.daemonPortText);
    if (daemonPort === null) {
      return { ok: false, error: "invalidDaemonPort" };
    }
    return parseUri(buildSshConfigHostTarget({ alias }, daemonPort));
  }
  const uri = input.manualTarget.trim();
  if (!uri) {
    return { ok: false, error: "targetRequired" };
  }
  return parseUri(uri);
}

function parseUri(uri: string): RemoteSshFormResult {
  try {
    return { ok: true, uri, target: parseSshTransportUri(uri) };
  } catch {
    return { ok: false, error: "invalidTarget" };
  }
}
