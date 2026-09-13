import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ImportUpload } from "./upload.js";

export async function assertDestinationIdentity(cwd: string, existing: boolean): Promise<void> {
  const expected = existing ? cwd : path.dirname(cwd);
  if ((await realpath(expected)) !== expected)
    throw new Error("The destination changed since preview; select it again");
}

export async function materializeProject(cwd: string, upload: ImportUpload): Promise<void> {
  await upload.conversations();
  const files = [...upload.files].filter(([, file]) => file.kind === "code");
  const existing = await stat(cwd).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  await assertDestinationIdentity(cwd, existing);
  if (existing && files.length)
    throw new Error(
      "The destination already exists. Merge conversation files only, or select a new destination for project files",
    );
  if (existing) return;
  const staging = await mkdtemp(path.join(path.dirname(cwd), ".frogg-project-import-"));
  try {
    await writeFile(path.join(staging, ".frogg-import-owner"), upload.id, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      path.join(upload.root, "materialization.json"),
      JSON.stringify({ path: staging, owner: upload.id }),
      { mode: 0o600 },
    );
    for (const [relative] of files) {
      const destination = path.join(staging, relative);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, await readFile(path.join(upload.root, "code", relative)), {
        flag: "wx",
        mode: 0o600,
      });
    }
    await assertDestinationIdentity(cwd, false);
    const occupied = await lstat(cwd).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (occupied)
      throw new Error("The destination was created during import; select a new directory");
    // Publish a complete tree. A colliding nonempty directory is never replaced by rename.
    await rename(staging, cwd);
    await rm(path.join(cwd, ".frogg-import-owner")).catch(() => undefined);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Explicit daemon-side export selection, not a scan of arbitrary home directories. */
export async function readDaemonConversations(
  directory: string,
): Promise<Array<{ path: string; content: Buffer }>> {
  const root = await realpath(directory);
  const result: Array<{ path: string; content: Buffer }> = [];
  let totalBytes = 0,
    visited = 0;
  const visit = async (current: string, depth: number): Promise<void> => {
    if ((await realpath(current)) !== current)
      throw new Error("Conversation directory changed during preview");
    if (depth > 12) throw new Error("Conversation directory exceeds the nesting limit");
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (++visited > 2000) throw new Error("Conversation directory exceeds the 2,000 entry limit");
      if (entry.isSymbolicLink()) continue;
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(filename, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      if (result.length >= 500) throw new Error("Select at most 500 conversations");
      const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.size > 16 * 1024 * 1024 ||
          totalBytes + info.size > 64 * 1024 * 1024
        )
          throw new Error("Conversation files exceed import byte limits");
        const buffer = Buffer.alloc(info.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const read = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        if (offset !== info.size)
          throw new Error("Conversation file changed while reading; retry preview");
        totalBytes += info.size;
        result.push({ path: path.relative(root, filename), content: buffer.subarray(0, offset) });
      } finally {
        await handle.close();
      }
    }
  };
  await visit(root, 0);
  return result;
}
