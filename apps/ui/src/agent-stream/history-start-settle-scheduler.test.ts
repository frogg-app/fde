import { describe, expect, it, vi } from "vitest";
import {
  HISTORY_START_MAX_SETTLE_FRAMES,
  createHistoryStartSettleScheduler,
} from "./history-start-settle-scheduler";

describe("history start settle scheduler", () => {
  it("does not restart its countdown when geometry keeps changing", () => {
    const frames = new Map<number, () => void>();
    let nextFrameId = 1;
    const onFrame = vi.fn();
    const onSettle = vi.fn();
    const scheduler = createHistoryStartSettleScheduler({
      settleFrames: 2,
      requestFrame(callback) {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => frames.delete(id),
      isSettling: () => true,
      isLoading: () => false,
      onFrame,
      onSettle,
    });
    const runNextFrame = () => {
      const next = frames.entries().next().value as [number, () => void] | undefined;
      if (!next) {
        throw new Error("Expected a scheduled settlement frame");
      }
      frames.delete(next[0]);
      next[1]();
    };

    scheduler.schedule();
    scheduler.schedule();
    runNextFrame();
    scheduler.schedule();
    runNextFrame();
    scheduler.schedule();
    runNextFrame();

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);
  });

  it("stops rescheduling when loading never clears", () => {
    // The countdown only advances while nothing is loading, so a loading signal that
    // stays true has to be bounded by the frame ceiling or the loop runs forever. On the
    // web viewport each frame writes scrollTop, which mounts rows whose pending
    // measurement is exactly what keeps isLoading() true.
    const frames = new Map<number, () => void>();
    let nextFrameId = 1;
    const onSettle = vi.fn();
    const scheduler = createHistoryStartSettleScheduler({
      settleFrames: 2,
      requestFrame(callback) {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => frames.delete(id),
      isSettling: () => true,
      isLoading: () => true,
      onSettle,
    });

    scheduler.schedule();
    let executed = 0;
    while (frames.size > 0) {
      executed += 1;
      if (executed > HISTORY_START_MAX_SETTLE_FRAMES * 2) {
        throw new Error("Settlement never stopped rescheduling under a stuck load");
      }
      const next = frames.entries().next().value as [number, () => void];
      frames.delete(next[0]);
      next[1]();
    }

    expect(executed).toBe(HISTORY_START_MAX_SETTLE_FRAMES);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("settles a slow load once it clears, without spending the ceiling", () => {
    const frames = new Map<number, () => void>();
    let nextFrameId = 1;
    let loading = true;
    const onSettle = vi.fn();
    const scheduler = createHistoryStartSettleScheduler({
      settleFrames: 2,
      requestFrame(callback) {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => frames.delete(id),
      isSettling: () => true,
      isLoading: () => loading,
      onSettle,
    });
    const runNextFrame = () => {
      const next = frames.entries().next().value as [number, () => void];
      frames.delete(next[0]);
      next[1]();
    };

    scheduler.schedule();
    runNextFrame();
    runNextFrame();
    expect(onSettle).not.toHaveBeenCalled();

    loading = false;
    runNextFrame();
    runNextFrame();
    runNextFrame();

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
