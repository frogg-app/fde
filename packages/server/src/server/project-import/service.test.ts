import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProjectImportService } from "./service.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const home = await mkdtemp(path.join(tmpdir(), "frogg-import-service-"));
  roots.push(home);
  const service = new ProjectImportService(home, {
    listNative: async () => [],
    importNative: async () => ({ agentId: "agent", skipped: false }),
    ensureProject: async (cwd) => ({ projectId: cwd }),
  });
  return { home, service };
}
const conversation = Buffer.from(
  JSON.stringify({ type: "user", message: { content: "Hello" } }),
).toString("base64");
async function uploadConversation(service: ProjectImportService, importId: string) {
  await service.upload(importId, {
    path: "session.jsonl",
    kind: "conversation",
    offset: 0,
    contentBase64: conversation,
    complete: true,
  });
  return (await service.preview(importId)).sessions[0].id;
}
it("preview does not create a project; commit and fresh-service retry deduplicate durable history", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "project");
  const prepared = await service.prepare("client", cwd);
  const id = await uploadConversation(service, prepared.importId);
  await expect(readFile(cwd)).rejects.toThrow();
  const result = await service.commit(prepared.importId, [id]);
  expect(result.importedTranscriptIds).toEqual([id]);
  const second = new ProjectImportService(home, {
    listNative: async () => [],
    importNative: async () => ({ agentId: "agent", skipped: false }),
    ensureProject: async (directory) => ({ projectId: directory }),
  });
  const retry = await second.prepare("client", cwd);
  const retryId = await uploadConversation(second, retry.importId);
  expect((await second.commit(retry.importId, [retryId])).skippedTranscriptIds).toEqual([id]);
  expect(await second.listHistory(cwd)).toHaveLength(1);
  expect((await second.readHistory(cwd, id)).messages).toEqual([{ role: "user", text: "Hello" }]);
});
it("never overwrites code when merging into an existing project", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "project");
  await mkdir(cwd);
  const { importId } = await service.prepare("client", cwd);
  await service.upload(importId, {
    path: "code.ts",
    kind: "code",
    offset: 0,
    contentBase64: Buffer.from("code").toString("base64"),
    complete: true,
  });
  const id = await uploadConversation(service, importId);
  await expect(service.commit(importId, [id])).rejects.toThrow("destination already exists");
  await expect(readFile(path.join(cwd, "code.ts"))).rejects.toThrow();
});
it("cancellation removes staged files and invalidates preview", async () => {
  const { home, service } = await setup();
  const { importId } = await service.prepare("client", path.join(home, "project"));
  await uploadConversation(service, importId);
  await service.cancel(importId);
  await expect(service.preview(importId)).rejects.toThrow("expired");
});
it("creates a new project with selected files and keeps retry imports idempotent", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "copied-project");
  const { importId } = await service.prepare("client", cwd);
  await service.upload(importId, {
    path: "src/main.ts",
    kind: "code",
    offset: 0,
    contentBase64: Buffer.from("export const answer = 42;").toString("base64"),
    complete: true,
  });
  const id = await uploadConversation(service, importId);
  const first = await service.commit(importId, [id]);
  expect(await readFile(path.join(cwd, "src/main.ts"), "utf8")).toBe("export const answer = 42;");
  expect(await service.commit(importId, [id])).toEqual(first);
  expect(first.importedAgentIds).toEqual([]);
  expect(first.importedTranscriptIds).toEqual([id]);
});
it("filters native sessions by canonical project directory and preserves native import", async () => {
  const { home } = await setup();
  const cwd = path.join(home, "native-project");
  await mkdir(cwd);
  const other = path.join(home, "other-project");
  await mkdir(other);
  const imported: string[] = [];
  const service = new ProjectImportService(home, {
    listNative: async () => [
      { provider: "claude", providerHandleId: "wanted", cwd, title: "Wanted" },
      { provider: "claude", providerHandleId: "other", cwd: other, title: "Other" },
    ],
    importNative: async (session) => {
      imported.push(session.providerHandleId);
      return { agentId: "agent", skipped: false };
    },
    ensureProject: async () => ({ projectId: "existing" }),
    findProject: async () => ({ projectId: "existing" }),
  });
  const prepared = await service.prepare("daemon", cwd);
  expect(prepared.projectId).toBe("existing");
  const preview = await service.preview(prepared.importId);
  expect(preview.sessions.map((session) => session.title)).toEqual(["Wanted"]);
  const result = await service.commit(
    prepared.importId,
    preview.sessions.map((session) => session.id),
  );
  expect(imported).toEqual(["wanted"]);
  expect(result.importedAgentIds).toEqual(["agent"]);
});
