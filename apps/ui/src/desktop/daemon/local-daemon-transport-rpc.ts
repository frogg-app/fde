import {
  closeLocalTransportSession,
  listenToLocalTransportEvents,
  openLocalTransportSession,
  sendLocalTransportMessage,
  type LocalTransportErrorDetail,
  type OpenLocalTransportSessionInput,
} from "./desktop-daemon";

export interface LocalDaemonTransportEvent {
  sessionId: string;
  kind: "open" | "message" | "close" | "error";
  text?: string | null;
  binaryBase64?: string | null;
  code?: number | null;
  reason?: string | null;
  error?: string | null;
  detail?: LocalTransportErrorDetail | null;
}

export interface LocalDaemonTransportRpc {
  openSession(input: OpenLocalTransportSessionInput): Promise<void>;
  /** `sessionId` lets the listener drop other sessions' traffic before normalizing it. */
  listenToEvents(
    handler: (event: LocalDaemonTransportEvent) => void,
    sessionId?: string,
  ): Promise<() => void>;
  sendMessage(input: { sessionId: string; text?: string; binaryBase64?: string }): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
}

export const defaultLocalDaemonTransportRpc: LocalDaemonTransportRpc = {
  openSession: openLocalTransportSession,
  listenToEvents: listenToLocalTransportEvents,
  sendMessage: sendLocalTransportMessage,
  closeSession: closeLocalTransportSession,
};
