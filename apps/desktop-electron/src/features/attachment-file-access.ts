import { open, rm } from "node:fs/promises";

// Matches the shared UI's existing 50 MiB attachment upload limit.
export const MAX_ATTACHMENT_FILE_BYTES = 50 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

interface AttachmentSource {
  stat(): Promise<{ size: number; isFile(): boolean }>;
  read(maxBytes: number): Promise<Buffer>;
  close(): Promise<void>;
}
interface AttachmentTarget {
  write(bytes: Buffer): Promise<void>;
  close(): Promise<void>;
}
export interface AttachmentFileAccess {
  openSource(filePath: string): Promise<AttachmentSource>;
  openTarget(filePath: string): Promise<AttachmentTarget>;
  remove(filePath: string): Promise<void>;
}

const filesystem: AttachmentFileAccess = {
  async openSource(filePath) {
    const handle = await open(filePath, "r");
    return {
      stat: () => handle.stat(),
      async read(maxBytes) {
        const buffer = Buffer.allocUnsafe(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, null);
        return buffer.subarray(0, bytesRead);
      },
      close: () => handle.close(),
    };
  },
  async openTarget(filePath) {
    const handle = await open(filePath, "w");
    return { write: (bytes) => handle.writeFile(bytes), close: () => handle.close() };
  },
  remove: (filePath) => rm(filePath, { force: true }),
};

function assertSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ATTACHMENT_FILE_BYTES) {
    throw new Error("ATTACHMENT_TOO_LARGE: File exceeds the 50MB attachment limit.");
  }
}

async function assertSource(source: AttachmentSource): Promise<number> {
  const info = await source.stat();
  if (!info.isFile()) throw new Error("Attachment source must be a regular file.");
  assertSize(info.size);
  return info.size;
}

async function readChunks(
  source: AttachmentSource,
  accept: (bytes: Buffer) => Promise<void>,
): Promise<number> {
  let total = 0;
  while (true) {
    const maxBytes = Math.min(READ_CHUNK_BYTES, MAX_ATTACHMENT_FILE_BYTES + 1 - total);
    const bytes = await source.read(maxBytes);
    if (bytes.length === 0) return total;
    total += bytes.length;
    assertSize(total);
    await accept(bytes);
  }
}

export async function copySizedAttachmentFile(
  input: { source: string; target: string },
  access: AttachmentFileAccess = filesystem,
): Promise<number> {
  const source = await access.openSource(input.source);
  try {
    const size = await assertSource(source);
    if (input.source === input.target) return size;
    const target = await access.openTarget(input.target);
    try {
      try {
        return await readChunks(source, (bytes) => target.write(bytes));
      } finally {
        await target.close();
      }
    } catch (error) {
      await access.remove(input.target);
      throw error;
    }
  } finally {
    await source.close();
  }
}

export async function readSizedAttachmentFile(
  filePath: string,
  access: AttachmentFileAccess = filesystem,
): Promise<Buffer> {
  const source = await access.openSource(filePath);
  try {
    await assertSource(source);
    const chunks: Buffer[] = [];
    const total = await readChunks(source, async (bytes) => {
      chunks.push(bytes);
    });
    return Buffer.concat(chunks, total);
  } finally {
    await source.close();
  }
}
