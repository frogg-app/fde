import { AttachmentSizeError, assertAttachmentFileSize } from "@/attachments/file-size";
import { getFileExtension } from "@/attachments/file-types";
import { copyDesktopAttachmentFile } from "@/desktop/attachments/desktop-file-commands";
import { readDesktopFileBase64 } from "@/desktop/attachments/desktop-preview-url";

export interface PickedFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function readDesktopFileBytes(path: string): Promise<Uint8Array> {
  const fileName = path.split(/[/\\]/).pop() || path;
  try {
    const { path: managedPath, byteSize } = await copyDesktopAttachmentFile({
      attachmentId: crypto.randomUUID(),
      sourcePath: path,
      extension: getFileExtension(path) || null,
    });
    assertAttachmentFileSize(byteSize, fileName);
    const base64 = await readDesktopFileBase64(managedPath);
    return base64ToUint8Array(base64);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ATTACHMENT_TOO_LARGE:")) throw new AttachmentSizeError(fileName);
    throw error;
  }
}
