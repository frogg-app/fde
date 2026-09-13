// Keep aligned with the native attachment reader's pre-allocation limit.
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export class AttachmentSizeError extends Error {
  constructor(public readonly fileName: string) {
    super(`File exceeds the 50MB attachment limit: ${fileName}`);
    this.name = "AttachmentSizeError";
  }
}

export function assertAttachmentFileSize(size: number, fileName: string): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE_BYTES) {
    throw new AttachmentSizeError(fileName);
  }
}

export async function readBrowserFileBytes(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
): Promise<Uint8Array> {
  assertAttachmentFileSize(file.size, file.name);
  return new Uint8Array(await file.arrayBuffer());
}

export interface AttachmentSelectionFile {
  name: string;
  size: number;
  readBytes(): Promise<Uint8Array>;
}

export async function readAttachmentSelection(
  files: AttachmentSelectionFile[],
): Promise<Uint8Array[]> {
  for (const file of files) assertAttachmentFileSize(file.size, file.name);
  const contents: Uint8Array[] = [];
  for (const file of files) {
    const bytes = await file.readBytes();
    assertAttachmentFileSize(bytes.byteLength, file.name);
    contents.push(bytes);
  }
  return contents;
}
