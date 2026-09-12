import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const garbageCollectAttachments = vi.fn();

vi.mock("@/attachments/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/attachments/service")>();
  return {
    ...actual,
    garbageCollectAttachments: (...args: unknown[]) => {
      garbageCollectAttachments(...args);
      return Promise.resolve();
    },
  };
});

const { flushAttachmentGc, useDraftStore } = await import("@/stores/draft-store");

function typeCharacters(count: number): void {
  for (let index = 0; index < count; index += 1) {
    useDraftStore.getState().saveDraftInput({
      draftKey: "server:agent",
      draft: { text: "x".repeat(index + 1), attachments: [] },
    });
  }
}

describe("attachment gc scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    garbageCollectAttachments.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it("does not collect once per keystroke", async () => {
    // Collection walks every stream item of every agent and then hits the filesystem, and
    // each call queues behind the last. One per keystroke built a backlog that kept
    // draining after typing stopped, which is what made input lag and then catch up.
    typeCharacters(40);
    await vi.advanceTimersByTimeAsync(0);

    expect(garbageCollectAttachments).not.toHaveBeenCalled();
  });

  it("collects once after typing pauses", async () => {
    typeCharacters(40);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(garbageCollectAttachments).toHaveBeenCalledTimes(1);
  });

  it("restarts the idle wait while typing continues", async () => {
    typeCharacters(5);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(garbageCollectAttachments).not.toHaveBeenCalled();

    typeCharacters(5);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(garbageCollectAttachments).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(garbageCollectAttachments).toHaveBeenCalledTimes(1);
  });

  it("can be flushed without waiting out the idle delay", async () => {
    typeCharacters(3);
    await flushAttachmentGc();

    expect(garbageCollectAttachments).toHaveBeenCalledTimes(1);
  });
});
