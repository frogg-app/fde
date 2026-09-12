import { useEffect, useRef, useState } from "react";
import { acquireAttachmentPreviewUrl } from "@/attachments/preview-url-cache";
import type { AttachmentMetadata } from "@/attachments/types";

export function useAttachmentPreviewUrl(
  attachment: AttachmentMetadata | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;

  const id = attachment?.id;
  const storageType = attachment?.storageType;
  const storageKey = attachment?.storageKey;
  const mimeType = attachment?.mimeType;

  useEffect(() => {
    let disposed = false;
    const current = attachmentRef.current;

    if (!current) {
      setUrl(null);
      return;
    }

    // Leased rather than resolved: these thumbnails sit inside the virtualized agent
    // stream, so the same attachment is mounted and unmounted repeatedly while scrolling.
    const lease = acquireAttachmentPreviewUrl(current);
    void lease.promise.then(
      (resolved) => {
        if (!disposed) {
          setUrl(resolved);
        }
        return resolved;
      },
      (error) => {
        console.error("[attachments] Failed to resolve preview URL", {
          attachmentId: current.id,
          error,
        });
        if (!disposed) {
          setUrl(null);
        }
      },
    );

    return () => {
      disposed = true;
      lease.release();
    };
  }, [id, storageType, storageKey, mimeType]);

  return url;
}
