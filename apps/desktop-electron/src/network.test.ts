import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerNetworkHandlers } from "./network.js";

type Handler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown;
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), probe: vi.fn() }));
vi.mock("./ipc-security.js", () => ({
  handleDesktopIpc: (channel: string, callback: Handler) => mocks.handlers.set(channel, callback),
}));
vi.mock("./network-service.js", () => ({
  localAddresses: vi.fn(),
  reverseLookup: vi.fn(),
  probeIdentity: mocks.probe,
}));

function handler(channel: string): Handler {
  const registered = mocks.handlers.get(channel);
  if (!registered) throw new Error(`Missing handler: ${channel}`);
  return registered;
}

describe("network cancellation IPC", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.probe.mockReset();
    registerNetworkHandlers();
  });

  it("only cancels requests owned by the sending renderer", async () => {
    let signal!: AbortSignal;
    let finish!: () => void;
    mocks.probe.mockImplementation((_url, activeSignal: AbortSignal) => {
      signal = activeSignal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const pending = handler("frogg:network:probeIdentity")(
      { sender: { id: 1 } },
      "http://10.0.0.1:9999/api/identity",
      "scan-1",
    );
    handler("frogg:network:cancelProbe")({ sender: { id: 2 } }, "scan-1");
    expect(signal.aborted).toBe(false);
    handler("frogg:network:cancelProbe")({ sender: { id: 1 } }, "scan-1");
    expect(signal.aborted).toBe(true);
    finish();
    await pending;
  });

  it("removes completed requests and accepts older clients without request IDs", async () => {
    mocks.probe.mockResolvedValue({ status: 200, body: null });
    await handler("frogg:network:probeIdentity")({ sender: { id: 1 } }, "url", "scan-2");
    const signal: AbortSignal = mocks.probe.mock.calls[0][1];
    handler("frogg:network:cancelProbe")({ sender: { id: 1 } }, "scan-2");
    expect(signal.aborted).toBe(false);
    await handler("frogg:network:probeIdentity")({ sender: { id: 1 } }, "url");
    expect(mocks.probe).toHaveBeenLastCalledWith("url");
  });
});
