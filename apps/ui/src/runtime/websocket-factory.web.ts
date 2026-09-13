import { defaultWebSocketFactory } from "@frogg/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@frogg/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return defaultWebSocketFactory;
}
