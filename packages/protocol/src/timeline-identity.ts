import type { AgentTimelineItem } from "./agent-types.js";

export function timelineItemIdentity(item: AgentTimelineItem): string | null {
  if (item.type === "tool_call") return item.callId;
  return null;
}
