import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import { buildSshTunnelArgs, validatePort, validateSshHost } from "@fde/protocol/ssh-transport";
import { brand } from "@fde/branding";
import { createSshPasswordEnvironment } from "./ssh-password.js";
import type { TransportEndpoint } from "./local-transport.js";

export interface LocalTransportTarget {
  transportType: "socket" | "pipe";
  transportPath: string;
}

export interface SshTransportTarget {
  transportType: "ssh";
  host: string;
  sshPort?: number;
  daemonPort?: number;
  sshPassword?: string;
}

export type TransportTarget = LocalTransportTarget | SshTransportTarget;

interface OpenTransportSessionInput {
  sessionId: string;
  target: TransportTarget;
  protocols: string[];
}

const WS_ENDPOINT_PATH = "/ws";
const SSH_STDERR_LIMIT = 8192;

/**
 * Build a WebSocket URL that connects through a Unix domain socket or Windows
 * named pipe.  The `ws` library supports these via the `ws+unix://` scheme:
 *
 *   ws+unix:///path/to/socket:/ws
 *   ws+unix://./pipe/paseo:/ws        (Windows named pipe)
 *
 * The part before `:` is the IPC path, the part after is the HTTP request
 * path used during the WebSocket upgrade handshake.
 */
function buildLocalWebSocketUrl(target: LocalTransportTarget): string {
  const ipcPath = target.transportPath;
  return `ws+unix://${ipcPath}:${WS_ENDPOINT_PATH}`;
}

export function describeTransportTarget(target: TransportTarget): string {
  if (target.transportType === "ssh") {
    return `Remote SSH host ${target.host}`;
  }
  return target.transportType === "pipe" ? "local daemon pipe" : "local daemon socket";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTransportTarget(value: unknown): TransportTarget {
  if (!isRecord(value)) {
    throw new Error("Desktop transport target must be an object.");
  }

  if (value.transportType === "socket" || value.transportType === "pipe") {
    const transportPath = typeof value.transportPath === "string" ? value.transportPath.trim() : "";
    if (!transportPath) {
      throw new Error("Local transport path is required.");
    }
    return { transportType: value.transportType, transportPath };
  }

  if (value.transportType === "ssh") return parseSshTransportTarget(value);
  throw new Error("Unsupported desktop transport type.");
}

function parseSshTransportTarget(value: Record<string, unknown>): SshTransportTarget {
  const host = validateSshHost(typeof value.host === "string" ? value.host : "");
  const sshPort =
    value.sshPort === undefined ? undefined : validatePortValue(value.sshPort, "SSH port");
  const daemonPort =
    value.daemonPort === undefined ? undefined : validatePortValue(value.daemonPort, "Daemon port");
  return {
    transportType: "ssh",
    host,
    ...(sshPort !== undefined ? { sshPort } : {}),
    ...(daemonPort !== undefined ? { daemonPort } : {}),
    ...(typeof value.sshPassword === "string" && value.sshPassword
      ? { sshPassword: value.sshPassword }
      : {}),
  };
}

function validatePortValue(value: unknown, label: string): number {
  if (typeof value !== "number") throw new Error(`${label} must be between 1 and 65535.`);
  try {
    return validatePort(value, label);
  } catch {
    throw new Error(`${label} must be between 1 and 65535.`);
  }
}

export function parseProtocols(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Desktop transport protocols must be a list.");
  if (
    value.some((item) => typeof item !== "string" || !/^[!#$%&'*+.^_`|~A-Za-z0-9-]+$/.test(item))
  ) {
    throw new Error("Desktop transport subprotocol is invalid.");
  }
  if (new Set(value).size !== value.length)
    throw new Error("Desktop transport subprotocols must be unique.");
  return value;
}

export function parseOpenTransportSessionInput(value: unknown): OpenTransportSessionInput {
  if (!isRecord(value)) {
    throw new Error("Desktop transport open input must be an object.");
  }

  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
    throw new Error("Desktop transport session ID is invalid.");
  }

  return {
    sessionId,
    target: parseTransportTarget(value.target),
    protocols: parseProtocols(value.protocols),
  };
}

export function buildSshArgs(target: SshTransportTarget): string[] {
  const args = buildSshTunnelArgs({
    host: target.host,
    ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
    daemonPort: target.daemonPort ?? brand.daemonPort,
  });
  if (target.sshPassword) {
    args.splice(
      args.indexOf("BatchMode=yes"),
      1,
      "NumberOfPasswordPrompts=1",
      "-o",
      "PreferredAuthentications=publickey,keyboard-interactive,password",
    );
  }
  return args;
}

function formatSshFailure(
  stderr: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const detail = stderr.trim();
  if (detail) return detail;
  if (signal) return `ssh exited with signal ${signal}`;
  return `ssh exited with code ${code ?? "unknown"}`;
}

export function resolveSshFailureDetail(failure: string | null, stderr: string): string | null {
  return failure ?? (stderr.trim() || null);
}

async function createSshProxy(target: SshTransportTarget): Promise<TransportEndpoint> {
  const auth = await createSshPasswordEnvironment(target.sshPassword);
  let server: Server | null = null;
  let socket: Socket | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let stderr = "";
  let failure: string | null = null;

  function close(): void {
    auth.cleanup();
    server?.close();
    server = null;
    socket?.destroy();
    socket = null;
    if (child && !child.killed) {
      child.kill();
    }
    child = null;
  }

  return new Promise((resolve, reject) => {
    server = createServer((acceptedSocket) => {
      socket = acceptedSocket;
      server?.close();
      server = null;

      child = spawn("ssh", buildSshArgs(target), {
        env: auth.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-SSH_STDERR_LIMIT);
      });
      child.on("error", (error) => {
        failure = error.message;
        acceptedSocket.destroy(error);
      });
      child.on("exit", (code, signal) => {
        if (code !== 0 || signal) {
          failure = formatSshFailure(stderr, code, signal);
        }
        acceptedSocket.destroy(failure ? new Error(failure) : undefined);
      });

      acceptedSocket.on("error", () => undefined);
      acceptedSocket.on("close", () => {
        if (child && !child.killed) {
          child.kill();
        }
      });
      acceptedSocket.pipe(child.stdin);
      child.stdout.pipe(acceptedSocket);
    });
    server.once("error", (error) => {
      close();
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        close();
        reject(new Error("Failed to allocate the Remote SSH proxy port."));
        return;
      }
      resolve({
        url: `ws://127.0.0.1:${address.port}${WS_ENDPOINT_PATH}`,
        close,
        failureDetail: () => resolveSshFailureDetail(failure, stderr),
      });
    });
  });
}

export async function resolveTransportEndpoint(
  target: TransportTarget,
): Promise<TransportEndpoint> {
  if (target.transportType === "ssh") {
    return createSshProxy(target);
  }
  return {
    url: buildLocalWebSocketUrl(target),
    close: () => undefined,
    failureDetail: () => null,
  };
}
