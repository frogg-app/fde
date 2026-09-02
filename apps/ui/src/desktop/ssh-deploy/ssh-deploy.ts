import { DEFAULT_SSH_DAEMON_PORT } from "@fde/protocol/ssh-transport";
import { listenToDesktopEvent, type DesktopEventUnlisten } from "@/desktop/electron/events";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";

/** Desktop bridge event name (`paseo:event:` is added by the shell). */
export const SSH_DEPLOY_EVENT = "ssh-deploy-event";
export const DEFAULT_SSH_DEPLOY_LISTEN_HOST = "127.0.0.1";

export type SshDeployMethod = "native" | "docker";

export interface SshDeployTarget {
  host: string;
  sshPort?: number;
}

/** What `ssh_deploy_probe` reports about the remote host. */
export interface SshDeployProbe {
  os: string;
  arch: string;
  hasDocker: boolean;
  hasSystemdUser: boolean;
  hasCurl: boolean;
  hasFde: { installed: boolean; version: string | null };
  hasDockerContainer: boolean;
  homeDir: string;
}

export type SshDeployEvent =
  | { jobId: string; kind: "log"; text: string; stream: "stdout" | "stderr" }
  | { jobId: string; kind: "done"; text: string | null }
  | { jobId: string; kind: "error"; detail: string; cancelled: boolean };

export interface SshDeployStartInput extends SshDeployTarget {
  method: SshDeployMethod;
  version?: string;
  listen?: string;
  bundleUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function flag(value: unknown): boolean {
  return value === true;
}

export function parseSshDeployProbe(raw: unknown): SshDeployProbe {
  if (!isRecord(raw)) {
    throw new Error("The probe returned no result.");
  }
  const fde = isRecord(raw.hasFde) ? raw.hasFde : {};
  const version = text(fde.version);
  return {
    os: text(raw.os),
    arch: text(raw.arch),
    hasDocker: flag(raw.hasDocker),
    hasSystemdUser: flag(raw.hasSystemdUser),
    hasCurl: flag(raw.hasCurl),
    hasFde: { installed: flag(fde.installed), version: version || null },
    hasDockerContainer: flag(raw.hasDockerContainer),
    homeDir: text(raw.homeDir),
  };
}

export function parseSshDeployEvent(raw: unknown): SshDeployEvent | null {
  if (!isRecord(raw)) return null;
  const jobId = text(raw.jobId);
  if (!jobId) return null;
  switch (raw.kind) {
    case "log":
      return {
        jobId,
        kind: "log",
        text: typeof raw.text === "string" ? raw.text : "",
        stream: raw.stream === "stderr" ? "stderr" : "stdout",
      };
    case "done":
      return { jobId, kind: "done", text: text(raw.text) || null };
    case "error":
      return {
        jobId,
        kind: "error",
        detail: text(raw.detail) || "Unknown error",
        cancelled: flag(raw.cancelled),
      };
    default:
      return null;
  }
}

/** Loopback on the daemon port the host was saved with: the SSH tunnel ends there. */
export function defaultSshDeployListen(daemonPort?: number): string {
  return `${DEFAULT_SSH_DEPLOY_LISTEN_HOST}:${daemonPort ?? DEFAULT_SSH_DAEMON_PORT}`;
}

/** `Linux x86_64`, `Darwin arm64`; empty when the probe had nothing. */
export function describeSshDeployPlatform(probe: Pick<SshDeployProbe, "os" | "arch">): string {
  return [probe.os, probe.arch].filter(Boolean).join(" ");
}

/** Which service manager the native installer will use on this host. */
export function sshDeployServiceKind(
  probe: Pick<SshDeployProbe, "os" | "hasSystemdUser">,
): "systemd" | "launchd" | "none" {
  if (probe.os === "Darwin") return "launchd";
  return probe.hasSystemdUser ? "systemd" : "none";
}

/** The card's primary action for the current state of the host. */
export function sshDeployPrimaryAction(
  probe: Pick<SshDeployProbe, "hasFde" | "hasDockerContainer">,
  method: SshDeployMethod,
  targetVersion: string | null,
): "deploy" | "upgrade" | "reinstall" {
  const installed = method === "docker" ? probe.hasDockerContainer : probe.hasFde.installed;
  if (!installed) return "deploy";
  const current = method === "native" ? probe.hasFde.version : null;
  if (current && targetVersion && current === targetVersion.replace(/^v/u, "")) {
    return "reinstall";
  }
  return "upgrade";
}

export async function probeSshDeploy(target: SshDeployTarget): Promise<SshDeployProbe> {
  return parseSshDeployProbe(
    await invokeDesktopCommand<unknown>("ssh_deploy_probe", {
      host: target.host,
      ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
    }),
  );
}

function jobIdOf(raw: unknown): string {
  const jobId = isRecord(raw) ? text(raw.jobId) : "";
  if (!jobId) {
    throw new Error("The deploy job did not start.");
  }
  return jobId;
}

export async function startSshDeploy(input: SshDeployStartInput): Promise<string> {
  return jobIdOf(await invokeDesktopCommand<unknown>("ssh_deploy_start", { ...input }));
}

export async function uninstallSshDeploy(
  input: SshDeployTarget & { method: SshDeployMethod },
): Promise<string> {
  return jobIdOf(await invokeDesktopCommand<unknown>("ssh_deploy_uninstall", { ...input }));
}

export async function cancelSshDeploy(jobId: string): Promise<void> {
  await invokeDesktopCommand<unknown>("ssh_deploy_cancel", { jobId });
}

export function listenToSshDeployEvents(
  handler: (event: SshDeployEvent) => void,
): Promise<DesktopEventUnlisten> {
  return listenToDesktopEvent<unknown>(SSH_DEPLOY_EVENT, (raw) => {
    const event = parseSshDeployEvent(raw);
    if (event) handler(event);
  });
}
