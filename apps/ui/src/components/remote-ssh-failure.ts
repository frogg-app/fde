import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";

/**
 * What a failed Remote SSH connect needs from the user, read off the error
 * text the shell and the daemon produce:
 *
 * - `daemon-password-required` / `daemon-password-incorrect`: the FDE
 *   daemon behind the tunnel closed the socket with 4401 ("Password
 *   required" / "Incorrect password"). This is the daemon's password, not
 *   ssh's.
 * - `ssh-auth`: ssh itself was refused with `Permission denied (…)` and the
 *   server's method list offers `password` or `keyboard-interactive`, so an
 *   ssh password can get in where keys did not.
 * - `ssh-host-key`: the host key is unknown or changed; only a terminal
 *   `ssh` can fix that.
 */
export type RemoteSshFailure =
  | { kind: "daemon-password-required" }
  | { kind: "daemon-password-incorrect" }
  | { kind: "ssh-auth"; methods: string[] }
  | { kind: "ssh-host-key" };

const PERMISSION_DENIED = /Permission denied \(([^)]*)\)/gu;
const PASSWORD_METHODS = new Set(["password", "keyboard-interactive"]);

function messagesOf(error: unknown): string[] {
  if (error instanceof DaemonConnectionTestError) {
    return [error.message, error.reason, error.lastError].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return typeof error === "string" ? [error] : [];
}

/** The methods ssh's last `Permission denied (…)` line lists, or `null`. */
export function parseSshAuthMethods(text: string): string[] | null {
  let methods: string[] | null = null;
  for (const match of text.matchAll(PERMISSION_DENIED)) {
    methods = (match[1] ?? "")
      .split(",")
      .map((method) => method.trim())
      .filter((method) => method.length > 0);
  }
  return methods;
}

export function classifyRemoteSshFailure(error: unknown): RemoteSshFailure | null {
  const messages = messagesOf(error);
  if (messages.length === 0) {
    return null;
  }
  if (messages.some((message) => message === "Password required")) {
    return { kind: "daemon-password-required" };
  }
  if (messages.some((message) => message === "Incorrect password")) {
    return { kind: "daemon-password-incorrect" };
  }
  const text = messages.join("\n");
  if (
    text.includes("Host key verification failed") ||
    text.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")
  ) {
    return { kind: "ssh-host-key" };
  }
  const methods = parseSshAuthMethods(text);
  if (methods && methods.some((method) => PASSWORD_METHODS.has(method))) {
    return { kind: "ssh-auth", methods };
  }
  return null;
}
