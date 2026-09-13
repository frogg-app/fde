import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { SessionOutboundMessage } from "@fde/protocol/messages";
import { dispatchProjectImport } from "./dispatch.js";
import { ProjectImportService } from "./service.js";
it("emits correlated preview and error responses without mutating projects", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fde-import-dispatch-"));
  try {
    const cwd = path.join(home, "project");
    await mkdir(cwd);
    let creations = 0;
    const service = new ProjectImportService(home, {
      listNative: async () => [],
      importNative: async () => ({ agentId: "agent", skipped: false }),
      ensureProject: async () => {
        creations++;
        return { projectId: "project" };
      },
    });
    const emitted: SessionOutboundMessage[] = [];
    await dispatchProjectImport(
      service,
      { type: "project.import.prepare.request", requestId: "prepare", source: "daemon", cwd },
      (message) => emitted.push(message),
    );
    const prepared = emitted[0];
    expect(prepared.type).toBe("project.import.prepare.response");
    if (prepared.type !== "project.import.prepare.response" || !prepared.payload.importId)
      throw new Error("Missing prepare response");
    await dispatchProjectImport(
      service,
      {
        type: "project.import.preview.request",
        requestId: "preview",
        importId: prepared.payload.importId,
      },
      (message) => emitted.push(message),
    );
    expect(emitted[1]).toMatchObject({
      type: "project.import.preview.response",
      payload: { requestId: "preview", error: null, sessions: [] },
    });
    await dispatchProjectImport(
      service,
      {
        type: "project.import.commit.request",
        requestId: "commit",
        importId: prepared.payload.importId,
        sessionIds: ["unpreviewed"],
      },
      (message) => emitted.push(message),
    );
    expect(emitted[2]).toMatchObject({
      type: "project.import.commit.response",
      payload: { requestId: "commit", error: expect.stringContaining("Preview") },
    });
    expect(creations).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
