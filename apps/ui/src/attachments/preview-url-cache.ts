import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";

/**
 * Shared, refcounted preview URLs for attachment thumbnails.
 *
 * Resolving a preview is expensive on desktop: the file is read from disk, base64
 * encoded, shipped across the Tauri IPC boundary and copied three more times on the main
 * thread to become a Blob URL. Thumbnails live inside the virtualized agent stream, so
 * rows unmount and remount as the reader scrolls, and resolving per mount made scrolling
 * back through history re-read every image it passed.
 *
 * Entries are kept while anyone holds them and for a while after, so a row that scrolls
 * out and back in reuses the URL instead of paying for it again. Idle entries are evicted
 * least-recently-released first, and eviction releases the underlying URL.
 *
 * The assistant-image path already had an equivalent cache; this is the same treatment
 * for the user-message thumbnail path, which was missed.
 */
const PREVIEW_URL_CACHE_CAPACITY = 500;

interface PreviewUrlEntry {
  attachment: AttachmentMetadata;
  pending: Promise<string>;
  url: string | null;
  consumers: number;
  disposed: boolean;
}

const entries = new Map<string, PreviewUrlEntry>();

/**
 * Identity of the thing being previewed.
 *
 * Deliberately not the attachment id alone: two metadata objects with the same id but a
 * different storage location or mime type resolve to different bytes.
 */
export function createAttachmentPreviewCacheKey(attachment: AttachmentMetadata): string {
  // JSON rather than a joined string: a storage key is a file path and could contain
  // whatever separator we picked, which would let two attachments collide on one key.
  return JSON.stringify([
    attachment.id,
    attachment.storageType ?? "",
    attachment.storageKey ?? "",
    attachment.mimeType ?? "",
  ]);
}

function disposeEntry(key: string, entry: PreviewUrlEntry): void {
  entry.disposed = true;
  entries.delete(key);
  const url = entry.url;
  if (url === null) {
    // Still resolving. Release whatever it produces, once it does.
    void entry.pending
      .then((resolved) =>
        releaseAttachmentPreviewUrl({ attachment: entry.attachment, url: resolved }),
      )
      .catch(() => {});
    return;
  }
  void releaseAttachmentPreviewUrl({ attachment: entry.attachment, url }).catch(() => {});
}

function evictIdleEntries(): void {
  if (entries.size <= PREVIEW_URL_CACHE_CAPACITY) {
    return;
  }
  for (const [key, entry] of entries) {
    if (entries.size <= PREVIEW_URL_CACHE_CAPACITY) {
      return;
    }
    if (entry.consumers === 0) {
      disposeEntry(key, entry);
    }
  }
}

export interface AttachmentPreviewLease {
  promise: Promise<string>;
  release: () => void;
}

/**
 * Take a lease on an attachment's preview URL, resolving it only if nobody else has.
 *
 * The caller must `release()` exactly once. Releasing does not revoke the URL
 * immediately -- it makes the entry evictable, so a remount can still reuse it.
 */
export function acquireAttachmentPreviewUrl(
  attachment: AttachmentMetadata,
): AttachmentPreviewLease {
  const key = createAttachmentPreviewCacheKey(attachment);
  let entry = entries.get(key);
  if (entry) {
    // Re-insert so iteration order stays least-recently-used first.
    entries.delete(key);
    entries.set(key, entry);
  } else {
    const created: PreviewUrlEntry = {
      attachment,
      pending: Promise.resolve(""),
      url: null,
      consumers: 0,
      disposed: false,
    };
    created.pending = resolveAttachmentPreviewUrl(attachment).then((url) => {
      if (created.disposed) {
        void releaseAttachmentPreviewUrl({ attachment, url }).catch(() => {});
        return url;
      }
      created.url = url;
      return url;
    });
    // A failed resolve must not be cached: the next mount should retry.
    void created.pending.catch(() => {
      if (entries.get(key) === created) {
        entries.delete(key);
      }
    });
    entry = created;
    entries.set(key, created);
  }

  entry.consumers += 1;
  const leased = entry;
  let released = false;
  return {
    promise: leased.pending,
    release() {
      if (released) {
        return;
      }
      released = true;
      leased.consumers -= 1;
      if (leased.consumers <= 0) {
        evictIdleEntries();
      }
    },
  };
}

/** Drop every cached preview. Exposed for tests and host switches. */
export function clearAttachmentPreviewUrlCache(): void {
  for (const [key, entry] of new Map(entries)) {
    disposeEntry(key, entry);
  }
  entries.clear();
}
