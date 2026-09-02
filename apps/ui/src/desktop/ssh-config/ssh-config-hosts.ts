import { DEFAULT_SSH_DAEMON_PORT } from "@fde/protocol/ssh-transport";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";

export interface SshConfigHost {
  alias: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
  identityFile: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toPortOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535
    ? value
    : null;
}

export function parseSshConfigHosts(raw: unknown): SshConfigHost[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const hosts: SshConfigHost[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const alias = toStringOrNull(entry.alias);
    if (!alias) continue;
    hosts.push({
      alias,
      hostName: toStringOrNull(entry.hostName),
      user: toStringOrNull(entry.user),
      port: toPortOrNull(entry.port),
      identityFile: toStringOrNull(entry.identityFile),
    });
  }
  return hosts;
}

/**
 * The target the Remote SSH form submits for a config host. Only the alias is
 * used: `ssh` resolves user, host name, port and identity from the config
 * itself, and expanding them here would bypass it. A daemon port other than
 * the default rides along as `?daemonPort=`, so the default keeps the plain
 * `ssh://<alias>` identity a host was first saved under.
 */
export function buildSshConfigHostTarget(
  host: Pick<SshConfigHost, "alias">,
  daemonPort: number = DEFAULT_SSH_DAEMON_PORT,
): string {
  const base = `ssh://${host.alias}`;
  return daemonPort === DEFAULT_SSH_DAEMON_PORT ? base : `${base}?daemonPort=${daemonPort}`;
}

/** `user@hostName:port`, omitting whatever the config does not set. */
export function formatSshConfigHostDetails(host: SshConfigHost): string {
  const hostName = host.hostName ?? "";
  if (!hostName) {
    return "";
  }
  const withUser = host.user ? `${host.user}@${hostName}` : hostName;
  return host.port ? `${withUser}:${host.port}` : withUser;
}

export async function listSshConfigHosts(): Promise<SshConfigHost[]> {
  return parseSshConfigHosts(await invokeDesktopCommand<unknown>("list_ssh_config_hosts"));
}
