export interface HistoryStartSettleScheduler {
  schedule(): void;
  cancel(): void;
}

/**
 * Ceiling on frames a single settlement may occupy, however loading behaves.
 *
 * The countdown below only advances while nothing is loading, so a loading signal that
 * never clears would otherwise reschedule forever. Each frame writes `scrollTop` and
 * forces layout, and on the web viewport that write mounts rows whose measurement keeps
 * the loading signal true -- the loop feeds its own continuation. Roughly three seconds
 * at 60Hz: far longer than a real settlement, short enough to bound a stuck one.
 */
export const HISTORY_START_MAX_SETTLE_FRAMES = 180;

export function createHistoryStartSettleScheduler(input: {
  settleFrames: number;
  maxFrames?: number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  isSettling: () => boolean;
  isLoading: () => boolean;
  onFrame?: () => void;
  onSettle: () => void;
}): HistoryStartSettleScheduler {
  let frameId: number | null = null;
  let remainingFrames = 0;
  let elapsedFrames = 0;
  const maxFrames = input.maxFrames ?? HISTORY_START_MAX_SETTLE_FRAMES;

  const tick = () => {
    input.onFrame?.();
    if (!input.isSettling()) {
      frameId = null;
      remainingFrames = 0;
      elapsedFrames = 0;
      return;
    }
    elapsedFrames += 1;
    if (elapsedFrames < maxFrames && (input.isLoading() || remainingFrames > 0)) {
      if (!input.isLoading()) {
        remainingFrames -= 1;
      }
      frameId = input.requestFrame(tick);
      return;
    }
    frameId = null;
    remainingFrames = 0;
    elapsedFrames = 0;
    input.onSettle();
  };

  return {
    schedule() {
      if (frameId !== null) {
        return;
      }
      remainingFrames = input.settleFrames;
      elapsedFrames = 0;
      frameId = input.requestFrame(tick);
    },
    cancel() {
      if (frameId !== null) {
        input.cancelFrame(frameId);
      }
      frameId = null;
      remainingFrames = 0;
      elapsedFrames = 0;
    },
  };
}
