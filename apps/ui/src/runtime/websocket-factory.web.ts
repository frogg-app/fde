import { defaultWebSocketFactory } from "@fde/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@fde/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return defaultWebSocketFactory;
}
