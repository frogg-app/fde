import { z } from "zod";

/**
 * The Companion's whole memory. Topics and tasks, one line of state each, so the
 * orchestrator can rebuild its prompt every turn without ever loading an agent
 * timeline. Anything longer belongs to a subagent, not here.
 */
export const CompanionNoteKindSchema = z.enum(["topic", "task"]);
export const CompanionNoteStatusSchema = z.enum(["open", "done"]);

export const CompanionNoteSchema = z.object({
  id: z.string().min(1),
  kind: CompanionNoteKindSchema,
  text: z.string().min(1),
  status: CompanionNoteStatusSchema,
  agentId: z.string().nullable(),
  updatedAt: z.string(),
});

export const CompanionNotebookSchema = z.object({
  notes: z.array(CompanionNoteSchema),
});

export type CompanionNoteKind = z.infer<typeof CompanionNoteKindSchema>;
export type CompanionNoteStatus = z.infer<typeof CompanionNoteStatusSchema>;
export type CompanionNote = z.infer<typeof CompanionNoteSchema>;
export type CompanionNotebook = z.infer<typeof CompanionNotebookSchema>;

export interface CompanionNoteInput {
  id: string;
  kind: CompanionNoteKind;
  text: string;
  status: CompanionNoteStatus;
  agentId: string | null;
}

/** Serialised notebook budget in the prompt. Enforced in bytes, not characters. */
export const NOTEBOOK_PROMPT_BYTE_CAP = 2048;

/** Hard ceiling on retained notes; the oldest fall off the end. */
export const NOTEBOOK_MAX_NOTES = 32;

export const EMPTY_NOTEBOOK: CompanionNotebook = { notes: [] };

/**
 * Load-time parse. Disk is a boundary and the file is hand-editable, so a note
 * that no longer validates is dropped rather than failing the whole notebook.
 */
export function parseNotebook(raw: unknown): CompanionNotebook {
  if (!raw || typeof raw !== "object") {
    return EMPTY_NOTEBOOK;
  }
  const candidates = (raw as { notes?: unknown }).notes;
  if (!Array.isArray(candidates)) {
    return EMPTY_NOTEBOOK;
  }
  const notes: CompanionNote[] = [];
  for (const candidate of candidates) {
    const parsed = CompanionNoteSchema.safeParse(candidate);
    if (parsed.success) {
      notes.push(parsed.data);
    }
  }
  return { notes: notes.slice(0, NOTEBOOK_MAX_NOTES) };
}

/**
 * Upsert by id, newest first. Pure: the store owns persistence.
 */
export function applyNote(
  notebook: CompanionNotebook,
  input: CompanionNoteInput,
  updatedAt: string,
): CompanionNotebook {
  const note: CompanionNote = {
    id: input.id,
    kind: input.kind,
    text: input.text.trim(),
    status: input.status,
    agentId: input.agentId,
    updatedAt,
  };
  const remaining = notebook.notes.filter((existing) => existing.id !== note.id);
  return { notes: [note, ...remaining].slice(0, NOTEBOOK_MAX_NOTES) };
}

function formatNote(note: CompanionNote): string {
  const agent = note.agentId ? ` [agent ${note.agentId}]` : "";
  return `- ${note.kind} (${note.status}): ${note.text}${agent}`;
}

/**
 * Render the notebook for the volatile tail of the prompt, truncated to the byte
 * cap by dropping the oldest notes. Never truncates mid-line: half a task line
 * reads as a different task.
 */
export function serializeNotebookForPrompt(notebook: CompanionNotebook): string {
  const lines = notebook.notes.map(formatNote);
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const cost = Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
    if (bytes + cost > NOTEBOOK_PROMPT_BYTE_CAP) {
      break;
    }
    kept.push(line);
    bytes += cost;
  }
  return kept.join("\n");
}
