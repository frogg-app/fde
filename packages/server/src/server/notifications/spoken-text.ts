import {
  resolveAgentAttentionGist,
  type AgentAttentionReason,
  type NotificationPermissionRequest,
} from "@fde/protocol/agent-attention-notification";

export const SPOKEN_NOTIFICATION_MAX_CHARS = 200;

export interface SpokenNotificationInput {
  reason: AgentAttentionReason;
  agentTitle: string | null;
  workspaceName: string | null;
  assistantMessage?: string | null;
  permissionRequest?: NotificationPermissionRequest | null;
}

function resolveSubject(input: SpokenNotificationInput): string {
  const agent = input.agentTitle?.trim() || null;
  const workspace = input.workspaceName?.trim() || null;
  if (agent && workspace) return `${agent} in ${workspace}`;
  if (agent) return agent;
  if (workspace) return `The agent in ${workspace}`;
  return "An agent";
}

function resolveLead(input: SpokenNotificationInput): string {
  const subject = resolveSubject(input);
  if (input.reason === "error") return `${subject} hit an error.`;
  if (input.reason === "permission") {
    const kind = input.permissionRequest?.kind;
    if (kind === "question") return `${subject} has a question.`;
    if (kind === "plan") return `${subject} wants you to review a plan.`;
    return `${subject} needs permission.`;
  }
  return `${subject} finished.`;
}

function trimToSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const lastStop = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (lastStop >= Math.floor(limit / 2)) {
    return window.slice(0, lastStop + 1);
  }
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/[\s,;:.-]+$/g, "")}…`;
}

function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/\.\.\.$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One or two sentences a person can take in from across the room: who needs them, why, and
 * the gist the notification body already carries. Capped so local TTS stays quick.
 */
export function composeSpokenNotificationText(input: SpokenNotificationInput): string {
  const lead = resolveLead(input);
  const gist = resolveAgentAttentionGist({
    reason: input.reason,
    assistantMessage: input.assistantMessage,
    permissionRequest: input.permissionRequest,
  });
  if (!gist) {
    return trimToSentence(lead, SPOKEN_NOTIFICATION_MAX_CHARS);
  }
  const remaining = SPOKEN_NOTIFICATION_MAX_CHARS - lead.length - 1;
  if (remaining < 20) {
    return trimToSentence(lead, SPOKEN_NOTIFICATION_MAX_CHARS);
  }
  return `${lead} ${trimToSentence(speakable(gist), remaining)}`;
}
