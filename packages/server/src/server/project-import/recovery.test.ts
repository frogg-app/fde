import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProjectImportService } from "./service.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const home = await mkdtemp(path.join(tmpdir(), "frogg-import-recovery-"));
  roots.push(home);
  return {
    home,
    service: new ProjectImportService(home, {
      listNative: async () => [],
      importNative: async () => ({ agentId: "agent", skipped: false }),
      ensureProject: async (cwd) => ({ projectId: cwd }),
    }),
  };
}
const conversation = JSON.stringify({ type: "user", message: { content: "Hello" } });
async function staged(service: ProjectImportService, cwd: string) {
  const prepared = await service.prepare("client", cwd);
  await service.upload(prepared.importId, {
    path: "session.jsonl",
    kind: "conversation",
    offset: 0,
    contentBase64: Buffer.from(conversation).toString("base64"),
    complete: true,
  });
  return prepared.importId;
}
it("failed materialization leaves no partial project and can retry", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "project");
  const id = await staged(service, cwd);
  await service.upload(id, {
    path: "a.txt",
    kind: "code",
    offset: 0,
    contentBase64: "YQ==",
    complete: true,
  });
  const sessions = (await service.preview(id)).sessions.map((item) => item.id);
  const [folder] = await readdir(path.join(home, "project-import-staging"));
  const code = path.join(home, "project-import-staging", folder, "code/a.txt");
  await unlink(code);
  await expect(service.commit(id, sessions)).rejects.toThrow();
  await expect(stat(cwd)).rejects.toThrow();
  await writeFile(code, "a");
  await service.commit(id, sessions);
  expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("a");
});
it("a queued commit cannot outlive cancellation", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "project");
  const id = await staged(service, cwd);
  const sessions = (await service.preview(id)).sessions.map((item) => item.id);
  const cancel = service.cancel(id);
  const commit = service.commit(id, sessions);
  await cancel;
  await expect(commit).rejects.toThrow("expired");
  await expect(stat(cwd)).rejects.toThrow();
});
it("rejects a destination replaced by a symlink after preview", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "project");
  await mkdir(cwd);
  const other = path.join(home, "other");
  await mkdir(other);
  const id = await staged(service, cwd);
  const sessions = (await service.preview(id)).sessions.map((item) => item.id);
  await rename(cwd, path.join(home, "original"));
  await symlink(other, cwd, "dir");
  await expect(service.commit(id, sessions)).rejects.toThrow("destination changed");
});
it("cleans up expired staging left by a daemon restart", async () => {
  const { home, service } = await setup();
  const orphan = path.join(home, "project-import-staging", randomUUID());
  await mkdir(orphan, { recursive: true });
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(orphan, old, old);
  await service.prepare("client", path.join(home, "project"));
  await expect(stat(orphan)).rejects.toThrow();
});
it("imports JSONL exported into a selected daemon directory", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "project");
  await mkdir(cwd);
  const exports = path.join(home, "exports");
  await mkdir(exports);
  await writeFile(path.join(exports, "session.jsonl"), conversation);
  const prepared = await service.prepare("daemon", cwd, exports);
  const preview = await service.preview(prepared.importId);
  expect(preview.sessions).toMatchObject([{ mode: "transcript", title: "Hello" }]);
  const result = await service.commit(
    prepared.importId,
    preview.sessions.map((item) => item.id),
  );
  expect(result.importedTranscriptIds).toHaveLength(1);
});
it("a corrupt expired cleanup manifest cannot block new imports", async () => {
  const { home, service } = await setup();
  const orphan = path.join(home, "project-import-staging", randomUUID());
  await mkdir(orphan, { recursive: true });
  await writeFile(path.join(orphan, "materialization.json"), '{"path":');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(orphan, old, old);
  const prepared = await service.prepare("client", path.join(home, "project"));
  expect(prepared.importId).toBeTruthy();
  await expect(stat(orphan)).rejects.toThrow();
});
it("extends an existing imported conversation without duplicating it", async () => {
  const { home, service } = await setup();
  const cwd = path.join(home, "project");
  await mkdir(cwd);
  const exports = path.join(home, "exports");
  await mkdir(exports);
  const first = JSON.stringify({
    type: "user",
    sessionId: "stable-session",
    message: { content: "Hello" },
  });
  const filename = path.join(exports, "session.jsonl");
  await writeFile(filename, first);
  const importOnce = async () => {
    const p = await service.prepare("daemon", cwd, exports);
    const preview = await service.preview(p.importId);
    return service.commit(
      p.importId,
      preview.sessions.map((item) => item.id),
    );
  };
  const one = await importOnce();
  await writeFile(
    filename,
    first +
      "\n" +
      JSON.stringify({
        type: "assistant",
        sessionId: "stable-session",
        message: { content: "Answer" },
      }),
  );
  const two = await importOnce();
  expect(two.importedTranscriptIds).toEqual(one.importedTranscriptIds);
  expect(await service.listHistory(cwd)).toHaveLength(1);
  expect((await service.readHistory(cwd, one.importedTranscriptIds[0])).messages).toHaveLength(2);
  await writeFile(filename, first);
  expect((await importOnce()).skippedTranscriptIds).toEqual(one.importedTranscriptIds);
});
it("serializes history updates when different directories resolve to the same project", async () => {
  const { home } = await setup();
  const project = "same-project";
  const service = new ProjectImportService(home, {
    listNative: async () => [],
    importNative: async () => ({ agentId: "agent", skipped: false }),
    ensureProject: async () => ({ projectId: project }),
  });
  const prepare = async (name: string) => {
    const cwd = path.join(home, name);
    await mkdir(cwd);
    const p = await service.prepare("client", cwd);
    const content = Buffer.from(
      JSON.stringify({ type: "user", sessionId: "same-session", message: { content: name } }),
    ).toString("base64");
    await service.upload(p.importId, {
      path: "session.jsonl",
      kind: "conversation",
      offset: 0,
      contentBase64: content,
      complete: true,
    });
    const preview = await service.preview(p.importId);
    return { id: p.importId, sessions: preview.sessions.map((entry) => entry.id) };
  };
  const first = await prepare("one"),
    second = await prepare("two");
  const results = await Promise.all([
    service.commit(first.id, first.sessions),
    service.commit(second.id, second.sessions),
  ]);
  expect(results.reduce((count, result) => count + result.importedTranscriptIds.length, 0)).toBe(1);
  expect(results.reduce((count, result) => count + result.failures.length, 0)).toBe(1);
  expect(await service.listHistory(project)).toHaveLength(1);
});
