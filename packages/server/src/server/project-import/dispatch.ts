import type { SessionInboundMessage, SessionOutboundMessage } from "@frogg/protocol/messages";
import type { ProjectImportService } from "./service.js";
export type ProjectImportRequest = Extract<
  SessionInboundMessage,
  { type: `project.import.${string}.request` }
>;

export async function dispatchProjectImport(
  service: ProjectImportService,
  message: ProjectImportRequest,
  emit: (response: SessionOutboundMessage) => void,
): Promise<void> {
  const requestId = message.requestId;
  try {
    switch (message.type) {
      case "project.import.prepare.request":
        emit({
          type: "project.import.prepare.response",
          payload: {
            requestId,
            error: null,
            ...(await service.prepare(message.source, message.cwd, message.conversationDirectory)),
          },
        });
        return;
      case "project.import.upload.request":
        await service.upload(message.importId, message);
        emit({ type: "project.import.upload.response", payload: { requestId, error: null } });
        return;
      case "project.import.preview.request":
        emit({
          type: "project.import.preview.response",
          payload: { requestId, error: null, ...(await service.preview(message.importId)) },
        });
        return;
      case "project.import.commit.request":
        emit({
          type: "project.import.commit.response",
          payload: {
            requestId,
            error: null,
            ...(await service.commit(message.importId, message.sessionIds)),
          },
        });
        return;
      case "project.import.cancel.request":
        await service.cancel(message.importId);
        emit({ type: "project.import.cancel.response", payload: { requestId, error: null } });
        return;
      case "project.import.list.request":
        emit({
          type: "project.import.list.response",
          payload: {
            requestId,
            error: null,
            conversations: await service.listHistory(message.projectId),
          },
        });
        return;
      case "project.import.read.request": {
        const transcript = await service.readHistory(message.projectId, message.id);
        const offset = message.offset ?? 0;
        // Bound response frames even for a large conversation.
        const messages: typeof transcript.messages = [];
        let bytes = 0;
        for (const row of transcript.messages.slice(offset)) {
          const size = Buffer.byteLength(row.text);
          if (messages.length && bytes + size > 128 * 1024) break;
          if (size > 128 * 1024) throw new Error("A conversation message is too large to display");
          messages.push(row);
          bytes += size;
        }
        const next = offset + messages.length;
        emit({
          type: "project.import.read.response",
          payload: {
            requestId,
            error: null,
            title: transcript.title,
            messages,
            nextOffset: next < transcript.messages.length ? next : null,
          },
        });
        return;
      }
    }
  } catch (error) {
    const type = message.type.replace(
      /\.request$/,
      ".response",
    ) as `project.import.${string}.response`;
    emit({
      type,
      payload: { requestId, error: error instanceof Error ? error.message : String(error) },
    } as SessionOutboundMessage);
  }
}
