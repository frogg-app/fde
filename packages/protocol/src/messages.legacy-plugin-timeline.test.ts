import { describe, expect, it } from "vitest";
import { FetchAgentTimelineResponseMessageSchema, WSOutboundMessageSchema } from "./messages.js";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";

// Plugins were removed after v0.7.0, but an older daemon can still hold plugin rows in an
// agent timeline. A page containing one must still parse, or the whole page is rejected.
const legacyPluginItem = {
  type: "plugin",
  id: "review-1",
  pluginId: "review",
  kind: "review",
  version: 1,
  data: { status: "running" },
};

function timelinePage(items: unknown[]) {
  return {
    type: "fetch_agent_timeline_response",
    payload: {
      requestId: "req-1",
      agentId: "agent-1",
      agent: null,
      direction: "tail",
      projection: "projected",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 2, nextSeq: 3 },
      startCursor: { epoch: "epoch-1", seq: 1 },
      endCursor: { epoch: "epoch-1", seq: 2 },
      hasOlder: false,
      hasNewer: false,
      entries: items.map((item, index) => ({
        provider: "claude",
        item,
        timestamp: "2026-09-13T00:00:00.000Z",
        seqStart: index + 1,
        seqEnd: index + 1,
        sourceSeqRanges: [{ startSeq: index + 1, endSeq: index + 1 }],
        collapsed: [],
      })),
      error: null,
    },
  };
}

describe("legacy plugin timeline items", () => {
  const page = timelinePage([{ type: "assistant_message", text: "hi" }, legacyPluginItem]);

  it("parses a timeline page from an older daemon that contains a plugin item", () => {
    expect(FetchAgentTimelineResponseMessageSchema.safeParse(page).success).toBe(true);
  });

  it("passes the ahead-of-time outbound validator the client uses", () => {
    const frame = { type: "session", message: page };
    expect(WSOutboundMessageSchema.safeParse(frame).success).toBe(true);
    expect(validateWSOutboundMessage(frame).success).toBe(true);
  });
});
