import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImportUpload, validateImportPath } from "./upload.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const makeUpload = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fde-import-test-"));
  roots.push(root);
  return new ImportUpload(root);
};
const chunk = (name: string, text: string, offset = 0, complete = true) => ({
  path: name,
  contentBase64: Buffer.from(text).toString("base64"),
  offset,
  complete,
  kind: "code" as const,
});
describe("project transfer boundary", () => {
  it("rejects traversal, system paths, credentials and portable path collisions", async () => {
    for (const filename of [
      "../x",
      "/x",
      "C:/x",
      "a\\x",
      "a/../x",
      ".env",
      "a/.env.local",
      "auth.json",
      ".git/config",
      "CON.txt",
      "a.",
    ])
      expect(() => validateImportPath(filename)).toThrow();
    const upload = await makeUpload();
    await upload.write(chunk("a.txt", "hello"));
    await expect(upload.write(chunk("A.txt", "world"))).rejects.toThrow("collide");
  });
  it("serializes concurrent chunks and rejects replay without appending duplicate bytes", async () => {
    const upload = await makeUpload();
    await Promise.all([
      upload.write(chunk("a.txt", "hello", 0, false)),
      upload.write(chunk("a.txt", " world", 5)),
    ]);
    await expect(upload.write(chunk("a.txt", " world", 5))).rejects.toThrow("state");
    expect(await readFile(path.join(upload.root, "code/a.txt"), "utf8")).toBe("hello world");
    expect(upload.totalBytes).toBe(11);
  });
  it("refuses incomplete and malformed uploads", async () => {
    const upload = await makeUpload();
    await expect(upload.write({ ...chunk("a", ""), contentBase64: "???" })).rejects.toThrow(
      "chunk",
    );
    await upload.write(chunk("a", "partial", 0, false));
    await expect(upload.conversations()).rejects.toThrow("finished");
  });
});
