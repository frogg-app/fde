import { describe, expect, it } from "vitest";
import { createQuitLifecycle, registerExternalQuitSignals } from "./quit-lifecycle";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function waitForQuitLifecycle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("quit-lifecycle", () => {
  it("turns external termination signals into one Electron quit", () => {
    const listeners = new Map<NodeJS.Signals, () => void>();
    const quits: string[] = [];

    registerExternalQuitSignals({
      signals: {
        on: (signal, listener) => {
          listeners.set(signal, listener);
        },
      },
      quit: () => quits.push("quit"),
    });

    expect(Array.from(listeners.keys())).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    listeners.get("SIGTERM")?.();
    listeners.get("SIGHUP")?.();
    expect(quits).toEqual(["quit"]);
  });

  it("revalidates updates before exiting", async () => {
    const updateDecision = deferred<boolean>();
    const events: string[] = [];

    const quitLifecycle = createQuitLifecycle({
      app: {
        exit: (code) => {
          events.push(`exit:${code}`);
        },
      },
      closeTransportSessions: () => {
        events.push("close-transports");
      },
      installAppUpdateOnQuit: () => updateDecision.promise,
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onUpdateError: () => {
        events.push("update-error");
      },
    });

    quitLifecycle.handleBeforeQuit({
      preventDefault: () => {
        events.push("prevent-default");
      },
    });

    expect(events).toEqual(["close-transports", "prevent-default"]);

    events.push("update-checked");
    updateDecision.resolve(false);
    await waitForQuitLifecycle();

    expect(events).toEqual(["close-transports", "prevent-default", "update-checked", "exit:0"]);

    quitLifecycle.handleBeforeQuit({
      preventDefault: () => {
        events.push("second-prevent-default");
      },
    });

    expect(events.at(-1)).toBe("close-transports");
    expect(events).not.toContain("second-prevent-default");
  });

  it("lets the updater own process exit when a validated update is installing", async () => {
    const exits: number[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      installAppUpdateOnQuit: async () => true,
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => {} });
    await waitForQuitLifecycle();
    quitLifecycle.handleBeforeQuitForUpdate();
    await waitForQuitLifecycle();

    expect(exits).toEqual([]);
  });

  it("recognizes a repeated quit as updater handoff", async () => {
    const exits: number[] = [];
    let preventedQuitCount = 0;
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      installAppUpdateOnQuit: async () => true,
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({
      preventDefault: () => preventedQuitCount++,
    });
    await waitForQuitLifecycle();
    quitLifecycle.handleBeforeQuit({
      preventDefault: () => preventedQuitCount++,
    });
    await waitForQuitLifecycle();

    expect(preventedQuitCount).toBe(1);
    expect(exits).toEqual([]);
  });

  it("exits when the updater does not take ownership before its deadline", async () => {
    const revalidationDeadline = new AbortController();
    const handoffDeadline = new AbortController();
    let deadlineCount = 0;
    const exits: number[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      installAppUpdateOnQuit: async () => true,
      createUpdateDeadlineSignal: () =>
        deadlineCount++ === 0 ? revalidationDeadline.signal : handoffDeadline.signal,
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => {} });
    await waitForQuitLifecycle();
    handoffDeadline.abort();
    await waitForQuitLifecycle();

    expect(exits).toEqual([0]);
  });

  it("does not intercept a quit started by a manual update", () => {
    const events: string[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => events.push(`exit:${code}`) },
      closeTransportSessions: () => events.push("close-transports"),
      installAppUpdateOnQuit: async () => {
        events.push("revalidate-update");
        return false;
      },
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onUpdateError: () => events.push("update-error"),
    });

    quitLifecycle.handleBeforeQuitForUpdate();
    quitLifecycle.handleBeforeQuit({
      preventDefault: () => events.push("prevent-default"),
    });

    expect(events).toEqual(["close-transports"]);
  });

  it("exits when update revalidation reaches its deadline", async () => {
    const deadline = new AbortController();
    const updateDecision = deferred<boolean>();
    const exits: number[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      installAppUpdateOnQuit: () => updateDecision.promise,
      createUpdateDeadlineSignal: () => deadline.signal,
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => {} });
    await waitForQuitLifecycle();
    deadline.abort();
    await waitForQuitLifecycle();

    expect(exits).toEqual([0]);

    updateDecision.resolve(true);
    await waitForQuitLifecycle();
    expect(exits).toEqual([0]);
  });
});
