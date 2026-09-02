import type { DaemonClient } from "@fde/client/internal/daemon-client";
import type { SessionOutboundMessage } from "@fde/protocol/messages";

export interface MessageCollector {
  messages: SessionOutboundMessage[];
  clear: () => void;
  unsubscribe: () => void;
}

export function createMessageCollector(client: DaemonClient): MessageCollector {
  const messages: SessionOutboundMessage[] = [];
  const unsubscribe = client.subscribeRawMessages((message) => {
    messages.push(message);
  });
  return {
    messages,
    clear: () => {
      messages.length = 0;
    },
    unsubscribe,
  };
}
