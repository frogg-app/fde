import { BrowserWindow } from "electron";
import { WebSocket, type RawData } from "ws";
import {
  describeTransportTarget,
  parseOpenTransportSessionInput,
  resolveTransportEndpoint,
  type TransportTarget,
} from "./transport-endpoint.js";
export {
  buildSshArgs,
  parseTransportTarget,
  parseProtocols,
  resolveSshFailureDetail,
} from "./transport-endpoint.js";
export type { TransportTarget } from "./transport-endpoint.js";

export interface TransportEventPayload {
  sessionId: string;
  kind: "open" | "message" | "close" | "error";
  text?: string | null;
  binaryBase64?: string | null;
  code?: number | null;
  reason?: string | null;
  error?: string | null;
}

interface Session {
  id: string;
  target: TransportTarget;
  protocols: string[];
  ws: TransportWebSocket | null;
  state: "opening" | "open" | "closed";
  closeTarget: (() => void) | null;
  cancelSetupDeadline: () => void;
}

export interface TransportEndpoint {
  url: string;
  close: () => void;
  failureDetail: () => string | null;
}

export interface TransportWebSocket {
  readonly readyState: number;
  once(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: RawData, isBinary: boolean) => void): void;
  on(event: "close", listener: (code: number, reason?: Buffer | string) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  send(data: string | Buffer, callback: (error?: Error) => void): void;
  close(): void;
  terminate(): void;
}

export interface LocalTransportManagerDependencies {
  resolveEndpoint(target: TransportTarget): Promise<TransportEndpoint>;
  createWebSocket(url: string, protocols: string[]): TransportWebSocket;
  scheduleTimeout(callback: () => void, delayMs: number): () => void;
  emitEvent(payload: TransportEventPayload): void;
}

export interface LocalTransportManager {
  open(rawInput: unknown): void;
  send(input: { sessionId: string; text?: string; binaryBase64?: string }): Promise<void>;
  close(sessionId: string): void;
  closeAll(): void;
}

export const LOCAL_TRANSPORT_SETUP_TIMEOUT_MS = 30_000;

function emitTransportEvent(payload: TransportEventPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("frogg:event:local-daemon-transport-event", payload);
  }
}

function decodeTransportMessage(input: { text?: string; binaryBase64?: string }): string | Buffer {
  if (typeof input.text === "string") {
    return input.text;
  }

  if (typeof input.binaryBase64 === "string") {
    return Buffer.from(input.binaryBase64, "base64");
  }

  throw new Error("Local transport send requires text or binary payload.");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLocalTransportManager(
  deps: LocalTransportManagerDependencies,
): LocalTransportManager {
  const sessions = new Map<string, Session>();

  function isCurrent(session: Session): boolean {
    return sessions.get(session.id) === session && session.state !== "closed";
  }

  function emitEvent(payload: TransportEventPayload): void {
    try {
      deps.emitEvent(payload);
    } catch {
      // A renderer may disappear while the main process is broadcasting an event.
    }
  }

  function disposeSession(session: Session): void {
    if (session.state === "closed") {
      return;
    }

    session.state = "closed";
    try {
      session.cancelSetupDeadline();
    } catch {
      // Continue releasing the socket and endpoint if a runtime adapter fails.
    }
    session.cancelSetupDeadline = () => undefined;
    if (sessions.get(session.id) === session) {
      sessions.delete(session.id);
    }

    const ws = session.ws;
    session.ws = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      } catch {
        // Closing is best-effort; the endpoint still owns the underlying transport.
      }
    }

    const closeTarget = session.closeTarget;
    session.closeTarget = null;
    try {
      closeTarget?.();
    } catch {
      // Closing is best-effort and must not prevent the registry from being released.
    }
  }

  function failOpeningSession(session: Session, message: string): void {
    if (!isCurrent(session) || session.state !== "opening") {
      return;
    }
    disposeSession(session);
    emitEvent({ sessionId: session.id, kind: "error", error: message });
  }

  async function connectSession(session: Session): Promise<void> {
    let endpoint: TransportEndpoint;
    try {
      endpoint = await deps.resolveEndpoint(session.target);
    } catch (error) {
      failOpeningSession(
        session,
        `Failed to connect to ${describeTransportTarget(
          session.target,
        )}: ${getErrorMessage(error)}`,
      );
      return;
    }

    if (!isCurrent(session) || session.state !== "opening") {
      try {
        endpoint.close();
      } catch {
        // The cancelled session no longer owns any other resources to release.
      }
      return;
    }

    let targetClosed = false;
    session.closeTarget = () => {
      if (targetClosed) {
        return;
      }
      targetClosed = true;
      endpoint.close();
    };

    let ws: TransportWebSocket;
    try {
      ws = deps.createWebSocket(endpoint.url, session.protocols);
    } catch (error) {
      failOpeningSession(
        session,
        `Failed to connect to ${describeTransportTarget(
          session.target,
        )}: ${getErrorMessage(error)}`,
      );
      return;
    }
    session.ws = ws;

    ws.once("open", () => {
      if (!isCurrent(session) || session.state !== "opening") {
        return;
      }
      session.cancelSetupDeadline();
      session.cancelSetupDeadline = () => undefined;
      session.state = "open";
      emitEvent({ sessionId: session.id, kind: "open" });
    });

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!isCurrent(session) || session.state !== "open") {
        return;
      }
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        emitEvent({
          sessionId: session.id,
          kind: "message",
          binaryBase64: buf.toString("base64"),
        });
        return;
      }

      emitEvent({
        sessionId: session.id,
        kind: "message",
        text: data.toString(),
      });
    });

    ws.on("close", (code: number, reason?: Buffer | string) => {
      if (!isCurrent(session)) {
        return;
      }
      if (session.state === "opening") {
        const failureDetail = endpoint.failureDetail();
        const detail = failureDetail ? `: ${failureDetail}` : "";
        failOpeningSession(
          session,
          `${describeTransportTarget(
            session.target,
          )} closed before the session became ready${detail}.`,
        );
        return;
      }

      disposeSession(session);
      emitEvent({
        sessionId: session.id,
        kind: "close",
        code,
        reason: reason ? String(reason) : "",
      });
    });

    ws.on("error", (error: Error) => {
      if (!isCurrent(session)) {
        return;
      }
      const failureDetail = endpoint.failureDetail();
      const detail = failureDetail ? `${error.message}: ${failureDetail}` : error.message;
      if (session.state === "opening") {
        failOpeningSession(
          session,
          `Failed to connect to ${describeTransportTarget(session.target)}: ${detail}`,
        );
        return;
      }

      emitEvent({ sessionId: session.id, kind: "error", error: detail });
    });
  }

  function open(rawInput: unknown): void {
    const { sessionId, target, protocols } = parseOpenTransportSessionInput(rawInput);
    if (sessions.has(sessionId)) {
      throw new Error(`Local transport session already exists: ${sessionId}`);
    }

    const session: Session = {
      id: sessionId,
      protocols,
      target,
      ws: null,
      state: "opening",
      closeTarget: null,
      cancelSetupDeadline: () => undefined,
    };
    sessions.set(sessionId, session);
    session.cancelSetupDeadline = deps.scheduleTimeout(() => {
      failOpeningSession(
        session,
        `Connection to ${describeTransportTarget(target)} timed out during setup.`,
      );
    }, LOCAL_TRANSPORT_SETUP_TIMEOUT_MS);
    void connectSession(session);
  }

  async function send(input: {
    sessionId: string;
    text?: string;
    binaryBase64?: string;
  }): Promise<void> {
    const session = sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Local transport session not found: ${input.sessionId}`);
    }

    const ws = session.ws;
    if (session.state !== "open" || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        session.state === "opening"
          ? "Local transport session is not open yet."
          : "Local transport session is closed.",
      );
    }

    const payload = decodeTransportMessage(input);
    await new Promise<void>((resolve, reject) => {
      ws.send(payload, (error) => {
        if (error) {
          reject(new Error(`Local transport write failed: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  function close(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      disposeSession(session);
    }
  }

  function closeAll(): void {
    for (const session of sessions.values()) {
      disposeSession(session);
    }
  }

  return { open, send, close, closeAll };
}

const localTransportManager = createLocalTransportManager({
  resolveEndpoint: resolveTransportEndpoint,
  createWebSocket: (url, protocols) => new WebSocket(url, protocols),
  scheduleTimeout: (callback, delayMs) => {
    const timeout = setTimeout(callback, delayMs);
    timeout.unref();
    return () => clearTimeout(timeout);
  },
  emitEvent: emitTransportEvent,
});

export function openLocalTransportSession(rawInput: unknown): void {
  localTransportManager.open(rawInput);
}

export async function sendLocalTransportMessage(input: {
  sessionId: string;
  text?: string;
  binaryBase64?: string;
}): Promise<void> {
  await localTransportManager.send(input);
}

export function closeLocalTransportSession(sessionId: string): void {
  localTransportManager.close(sessionId);
}

export function closeAllTransportSessions(): void {
  localTransportManager.closeAll();
}
