import type { CompanionConversationOptions } from "@fde/protocol/messages";

export function companionConversationInstructions(options: CompanionConversationOptions): string {
  return [
    "Conversation preferences (apply throughout this session):",
    options.verbosity === "brief"
      ? "Keep each answer under 45 words, usually one sentence. Give the result, blocker or decision; omit process narration."
      : "Explain results when useful, but do not narrate tool calls or repeat progress.",
    options.acknowledgeTasks
      ? "You may acknowledge a new task once in a few words, then wait for a meaningful result."
      : "For task dispatch, call the tools silently. Do not say that you are starting, checking, reading or waiting. Speak when work is complete, something important changes, or you need a decision. Direct conversational questions still deserve an answer.",
    `Initial project context: ${JSON.stringify({ workspaceId: options.workspaceId ?? null, agentId: options.agentId ?? null })}. Resolve these IDs using the host's tools; do not assume a different project when the UI navigates. The user may explicitly choose another project by voice.`,
  ].join("\n");
}
