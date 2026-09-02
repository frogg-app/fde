import { afterEach, describe, expect, it, vi } from "vitest";

const hostState: { host: unknown } = { host: null };

vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => hostState.host,
  isElectronRuntime: () => hostState.host !== null,
}));

describe("listenToLocalTransportEvents", () => {
  afterEach(() => {
    hostState.host = null;
  });

  it("accepts the bare payload and a {payload} envelope alike", async () => {
    const listeners: Array<(event: unknown) => void> = [];
    hostState.host = {
      events: {
        on: async (_name: string, handler: (event: unknown) => void) => {
          listeners.push(handler);
          return () => {};
        },
      },
    };
    const { listenToLocalTransportEvents } = await import("./desktop-daemon");
    const received: unknown[] = [];
    await listenToLocalTransportEvents((event) => received.push(event));
    const listener = listeners[0]!;

    // Electron's preload passes the payload; Tauri's `listen` wraps it.
    listener({ sessionId: "s1", kind: "open" });
    listener({
      event: "paseo:event:x",
      id: 7,
      payload: { sessionId: "s1", kind: "error", error: "ssh: boom" },
    });

    expect(received).toEqual([
      {
        sessionId: "s1",
        kind: "open",
        text: null,
        binaryBase64: null,
        code: null,
        reason: null,
        error: null,
      },
      {
        sessionId: "s1",
        kind: "error",
        text: null,
        binaryBase64: null,
        code: null,
        reason: null,
        error: "ssh: boom",
      },
    ]);
  });

  it("fails when the desktop event API is missing", async () => {
    hostState.host = {};
    const { listenToLocalTransportEvents } = await import("./desktop-daemon");
    await expect(listenToLocalTransportEvents(() => {})).rejects.toThrow(
      "Desktop events API is unavailable.",
    );
  });
});
