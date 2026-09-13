import { assertAttachmentFileSize, readBrowserFileBytes } from "@/attachments/file-size";
import {
  getMimeTypeFromPath,
  isRasterImageFile,
  isRasterImagePath,
} from "@/attachments/file-types";
import { readDesktopFileBytes, type PickedFile } from "@/attachments/picked-file";
import type { DroppedItem } from "@/components/file-drop/types";

interface DroppedAttachmentsRuntime {
  readDesktopFileBytes(path: string): Promise<Uint8Array>;
}

const defaultRuntime: DroppedAttachmentsRuntime = {
  readDesktopFileBytes,
};

function fileNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) {
      return segment;
    }
  }
  return path;
}

export async function droppedItemsToPickedFiles(
  items: DroppedItem[],
  runtime: DroppedAttachmentsRuntime = defaultRuntime,
): Promise<PickedFile[]> {
  for (const item of items) {
    if (item.kind === "web-file" && !isRasterImageFile(item.file)) {
      assertAttachmentFileSize(item.file.size, item.file.name);
    }
  }
  const files: PickedFile[] = [];

  for (const item of items) {
    if (item.kind === "web-file") {
      if (isRasterImageFile(item.file)) {
        continue;
      }
      files.push({
        fileName: item.file.name,
        mimeType: item.file.type || getMimeTypeFromPath(item.file.name),
        bytes: await readBrowserFileBytes(item.file),
      });
      continue;
    }

    if (isRasterImagePath(item.path)) {
      continue;
    }
    files.push({
      fileName: fileNameFromPath(item.path),
      mimeType: getMimeTypeFromPath(item.path),
      bytes: await runtime.readDesktopFileBytes(item.path),
    });
  }

  return files;
}
