import type { CompanionNotebookEntry, CompanionNotebookEntryStatus } from "@fde/protocol/messages";
import type { SessionState } from "@/stores/session-store";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

/** One notebook line, resolved against the session store for display. */
export interface CompanionTopicRow {
  id: string;
  text: string;
  status: CompanionNotebookEntryStatus;
  agent: CompanionTopicAgent | null;
}

export interface CompanionTopicAgent {
  serverId: string;
  agentId: string;
  label: string;
}

export interface CompanionTopicDot {
  bucket: SidebarStateBucket;
  showDoneAsInactive: boolean;
}

/**
 * The notebook's three statuses onto the app's status-dot vocabulary. A tracked
 * topic nobody is working reads as an inactive dot, an active one borrows the
 * running blue, and a finished one resolves to no colour at all so the row goes
 * quiet without losing its alignment.
 */
export function companionTopicDot(status: CompanionNotebookEntryStatus): CompanionTopicDot {
  if (status === "active") {
    return { bucket: "running", showDoneAsInactive: false };
  }
  return { bucket: "done", showDoneAsInactive: status === "open" };
}

/**
 * Resolved once by the strip's owner rather than per row: a row that looked up
 * its own agent would put one store selector on every notebook line.
 */
export function buildCompanionTopicRows(input: {
  entries: readonly CompanionNotebookEntry[];
  serverId: string | null;
  session: SessionState | undefined;
}): CompanionTopicRow[] {
  return input.entries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    status: entry.status,
    agent: resolveAgent(entry.agentId, input.serverId, input.session),
  }));
}

function resolveAgent(
  agentId: string | null,
  serverId: string | null,
  session: SessionState | undefined,
): CompanionTopicAgent | null {
  if (!agentId || !serverId) {
    return null;
  }
  const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
  const title = agent?.title?.trim();
  return {
    serverId,
    agentId,
    label: title && title.length > 0 ? title : agentId,
  };
}
