import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { readImportChunk, type ImportFile } from "./files";

export function validateSelection(files: ImportFile[]): void {
  if (
    files.length > 2000 ||
    files.reduce((sum, entry) => sum + entry.file.size, 0) > 64 * 1024 * 1024 ||
    files.some((entry) => entry.file.size > 16 * 1024 * 1024)
  )
    throw new Error("Import supports at most 2,000 files, 16 MiB per file and 64 MiB in total");
  const seen = new Set<string>();
  for (const entry of files) {
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw new Error("Selected files have duplicate names");
    seen.add(key);
  }
}
export async function transferImportFiles(
  client: Pick<DaemonClient, "projectImportUpload">,
  importId: string,
  files: ImportFile[],
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<void> {
  validateSelection(files);
  const total = files.reduce((sum, entry) => sum + entry.file.size, 0);
  let done = 0;
  for (const entry of files) {
    let offset = 0;
    do {
      signal.throwIfAborted();
      const bytes = Math.min(192 * 1024, entry.file.size - offset);
      const contentBase64 = await readImportChunk(entry.file, offset, bytes);
      signal.throwIfAborted();
      const result = await client.projectImportUpload({
        importId,
        path: entry.path,
        kind: entry.kind,
        offset,
        contentBase64,
        complete: offset + bytes >= entry.file.size,
      });
      if (result.error) throw new Error(result.error);
      offset += bytes;
      done += bytes;
      progress(done, total);
    } while (offset < entry.file.size);
  }
}
