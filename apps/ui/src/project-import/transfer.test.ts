import { expect, it, vi } from "vitest";
import { transferImportFiles, validateSelection } from "./transfer";
import { readImportChunk } from "./files";
vi.mock("./files", () => ({ readImportChunk: vi.fn(async () => "YQ==") }));
it("rejects oversized selections before reading local files", async () => {
  const files = [{ path: "large", file: { size: 16 * 1024 * 1024 + 1 }, kind: "code" as const }];
  expect(() => validateSelection(files)).toThrow("16 MiB");
  const upload = vi.fn();
  await expect(
    transferImportFiles(
      { projectImportUpload: upload },
      "id",
      files,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow();
  expect(readImportChunk).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});
it("stops after a server-side upload failure", async () => {
  const upload = vi.fn().mockResolvedValue({ error: "Disk full" });
  await expect(
    transferImportFiles(
      { projectImportUpload: upload },
      "id",
      [{ path: "a", file: { size: 500000 }, kind: "code" }],
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("Disk full");
  expect(upload).toHaveBeenCalledTimes(1);
});
it("cancels before reading or uploading another chunk", async () => {
  const controller = new AbortController();
  controller.abort();
  const upload = vi.fn();
  await expect(
    transferImportFiles(
      { projectImportUpload: upload },
      "id",
      [{ path: "a", file: { size: 1 }, kind: "code" }],
      controller.signal,
      () => {},
    ),
  ).rejects.toThrow();
  expect(upload).not.toHaveBeenCalled();
});
