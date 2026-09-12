import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAttachmentPreviewUrl = vi.fn();
const releaseAttachmentPreviewUrl = vi.fn();

vi.mock("@/attachments/service", () => ({
  resolveAttachmentPreviewUrl: (...args: unknown[]) => resolveAttachmentPreviewUrl(...args),
  releaseAttachmentPreviewUrl: (...args: unknown[]) => releaseAttachmentPreviewUrl(...args),
}));

const { acquireAttachmentPreviewUrl, clearAttachmentPreviewUrlCache } =
  await import("@/attachments/preview-url-cache");

type Attachment = Parameters<typeof acquireAttachmentPreviewUrl>[0];

function attachment(id: string): Attachment {
  return {
    id,
    storageType: "desktop-file",
    storageKey: `/tmp/${id}.png`,
    mimeType: "image/png",
    createdAt: 0,
  };
}

describe("attachment preview url cache", () => {
  beforeEach(() => {
    resolveAttachmentPreviewUrl.mockReset();
    releaseAttachmentPreviewUrl.mockReset();
    resolveAttachmentPreviewUrl.mockImplementation(
      async (input: { id: string }) => `blob:${input.id}`,
    );
    releaseAttachmentPreviewUrl.mockResolvedValue(undefined);
    clearAttachmentPreviewUrlCache();
    releaseAttachmentPreviewUrl.mockClear();
  });

  afterEach(() => {
    clearAttachmentPreviewUrlCache();
  });

  it("resolves once for concurrent holders of the same attachment", async () => {
    const first = acquireAttachmentPreviewUrl(attachment("a"));
    const second = acquireAttachmentPreviewUrl(attachment("a"));

    await expect(first.promise).resolves.toBe("blob:a");
    await expect(second.promise).resolves.toBe("blob:a");
    expect(resolveAttachmentPreviewUrl).toHaveBeenCalledTimes(1);
  });

  it("reuses a released entry when a row remounts", async () => {
    // This is the scroll case: a thumbnail unmounts on its way out of the virtualized
    // window and mounts again on the way back. Re-reading would mean another full file
    // read plus base64 IPC round trip per image.
    const first = acquireAttachmentPreviewUrl(attachment("b"));
    await first.promise;
    first.release();

    const second = acquireAttachmentPreviewUrl(attachment("b"));
    await expect(second.promise).resolves.toBe("blob:b");
    expect(resolveAttachmentPreviewUrl).toHaveBeenCalledTimes(1);
    expect(releaseAttachmentPreviewUrl).not.toHaveBeenCalled();
  });

  it("does not release a url that another holder is still using", async () => {
    const first = acquireAttachmentPreviewUrl(attachment("c"));
    const second = acquireAttachmentPreviewUrl(attachment("c"));
    await first.promise;

    first.release();
    expect(releaseAttachmentPreviewUrl).not.toHaveBeenCalled();

    second.release();
    clearAttachmentPreviewUrlCache();
    expect(releaseAttachmentPreviewUrl).toHaveBeenCalledWith({
      attachment: expect.objectContaining({ id: "c" }),
      url: "blob:c",
    });
  });

  it("ignores a repeated release from the same holder", async () => {
    const first = acquireAttachmentPreviewUrl(attachment("d"));
    const second = acquireAttachmentPreviewUrl(attachment("d"));
    await first.promise;

    first.release();
    first.release();
    // The second holder is still live, so the entry must not have been evictable.
    clearAttachmentPreviewUrlCache();
    expect(releaseAttachmentPreviewUrl).toHaveBeenCalledTimes(1);
    void second;
  });

  it("retries after a failed resolve instead of caching the failure", async () => {
    resolveAttachmentPreviewUrl.mockRejectedValueOnce(new Error("nope"));
    const first = acquireAttachmentPreviewUrl(attachment("e"));
    await expect(first.promise).rejects.toThrow("nope");
    first.release();

    const second = acquireAttachmentPreviewUrl(attachment("e"));
    await expect(second.promise).resolves.toBe("blob:e");
    expect(resolveAttachmentPreviewUrl).toHaveBeenCalledTimes(2);
  });

  it("evicts idle entries once over capacity, releasing their urls", async () => {
    const leases = [];
    for (let index = 0; index < 520; index += 1) {
      const lease = acquireAttachmentPreviewUrl(attachment(`bulk-${index}`));
      leases.push(lease);
    }
    await Promise.all(leases.map((lease) => lease.promise));
    for (const lease of leases) {
      lease.release();
    }

    expect(releaseAttachmentPreviewUrl).toHaveBeenCalled();
    // The oldest released entries go first, so the most recent one survives.
    const lastAgain = acquireAttachmentPreviewUrl(attachment("bulk-519"));
    await lastAgain.promise;
    expect(resolveAttachmentPreviewUrl).toHaveBeenCalledTimes(520);
  });
});
