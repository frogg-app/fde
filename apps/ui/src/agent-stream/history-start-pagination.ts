export const HISTORY_START_THRESHOLD_PX = 96;

/** Pages a settle may chain before it waits for the reader to scroll again. */
export const MAX_AUTO_CONTINUED_PAGES = 2;

export type HistoryStartPaginationState =
  | { status: "dormant" }
  | { status: "ready" }
  | {
      status: "loading";
      requestedProgressKey: string;
      requestObserved: boolean;
      /**
       * Pages loaded since the last real user intent.
       *
       * Continuing after a settled page exists so a page shorter than the viewport cannot
       * strand the reader at a dead history start with more history available. Left
       * unbounded it chained instead: the prepend anchor keeps the reader inside the
       * threshold, so each settle immediately requested another page. One sustained scroll
       * was measured pulling 13 pages over 22.7s, and because each page re-renders the
       * viewport synchronously that storm kept blocking input long after the scroll ended.
       */
      autoContinuedPages: number;
    }
  | { status: "settling"; loadedProgressKey: string; autoContinuedPages: number }
  | { status: "latched" };

export interface HistoryStartPaginationInput {
  distanceFromHistoryStart: number;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  isReady: boolean;
  progressKey: string | null;
}

export interface HistoryStartPaginationTransition {
  state: HistoryStartPaginationState;
  shouldLoad: boolean;
}

export function createHistoryStartPaginationState(): HistoryStartPaginationState {
  return { status: "dormant" };
}

export function isHistoryStartLoadingOperation(state: HistoryStartPaginationState): boolean {
  return state.status === "loading" || state.status === "settling";
}

export function rearmHistoryStartPagination(
  state: HistoryStartPaginationState,
): HistoryStartPaginationState {
  return state.status === "dormant" || state.status === "latched" ? { status: "ready" } : state;
}

export function abandonHistoryStartPaginationRequest(
  state: HistoryStartPaginationState,
  requestedProgressKey: string,
): HistoryStartPaginationState {
  if (
    state.status !== "loading" ||
    state.requestObserved ||
    state.requestedProgressKey !== requestedProgressKey
  ) {
    return state;
  }
  return { status: "latched" };
}

export function evaluateHistoryStartPagination(
  state: HistoryStartPaginationState,
  input: HistoryStartPaginationInput,
): HistoryStartPaginationTransition {
  if (state.status === "dormant") {
    return { state, shouldLoad: false };
  }
  if (state.status === "loading") {
    if (input.progressKey !== null && input.progressKey !== state.requestedProgressKey) {
      return {
        state: {
          status: "settling",
          loadedProgressKey: input.progressKey,
          autoContinuedPages: state.autoContinuedPages,
        },
        shouldLoad: false,
      };
    }
    if (input.isLoadingOlderHistory && !state.requestObserved) {
      return { state: { ...state, requestObserved: true }, shouldLoad: false };
    }
    if (!input.isLoadingOlderHistory && !input.hasOlderHistory) {
      return { state: { status: "latched" }, shouldLoad: false };
    }
    if (
      state.requestObserved &&
      !input.isLoadingOlderHistory &&
      input.progressKey === state.requestedProgressKey
    ) {
      return { state: { status: "latched" }, shouldLoad: false };
    }
    return { state, shouldLoad: false };
  }

  if (state.status === "settling") {
    return { state, shouldLoad: false };
  }

  const isAtHistoryStart = input.distanceFromHistoryStart <= HISTORY_START_THRESHOLD_PX;
  if (!isAtHistoryStart) {
    return state.status === "ready"
      ? { state, shouldLoad: false }
      : { state: { status: "ready" }, shouldLoad: false };
  }
  if (
    state.status === "latched" ||
    !input.isReady ||
    !input.hasOlderHistory ||
    input.isLoadingOlderHistory ||
    input.progressKey === null
  ) {
    return { state, shouldLoad: false };
  }
  return {
    state: {
      status: "loading",
      requestedProgressKey: input.progressKey,
      requestObserved: false,
      autoContinuedPages: 0,
    },
    shouldLoad: true,
  };
}

export function settleHistoryStartPagination(
  state: HistoryStartPaginationState,
  input: HistoryStartPaginationInput,
): HistoryStartPaginationTransition {
  if (state.status !== "settling") {
    return { state, shouldLoad: false };
  }
  const isAtHistoryStart = input.distanceFromHistoryStart <= HISTORY_START_THRESHOLD_PX;
  if (
    !isAtHistoryStart ||
    !input.isReady ||
    !input.hasOlderHistory ||
    input.isLoadingOlderHistory ||
    input.progressKey === null ||
    state.autoContinuedPages >= MAX_AUTO_CONTINUED_PAGES
  ) {
    return {
      state: isAtHistoryStart ? { status: "latched" } : { status: "ready" },
      shouldLoad: false,
    };
  }
  return {
    state: {
      status: "loading",
      requestedProgressKey: input.progressKey,
      requestObserved: false,
      autoContinuedPages: state.autoContinuedPages + 1,
    },
    shouldLoad: true,
  };
}
