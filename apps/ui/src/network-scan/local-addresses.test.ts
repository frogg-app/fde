import { describe, expect, it, vi } from "vitest";
import { readShellProbe } from "./local-addresses";
const network = vi.hoisted(() => ({ probeIdentity: vi.fn(), cancelProbe: vi.fn() }));
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => ({ network }) }));
vi.mock("@/constants/platform", () => ({ isWeb: false }));

describe("desktop scan cancellation", () => {
  it("cancels the matching native request and removes the listener after completion", async () => {
    let finish!: (answer: { status: number; body: unknown }) => void;
    network.probeIdentity.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    network.cancelProbe.mockResolvedValue(undefined);
    const probe = readShellProbe();
    expect(probe).toBeDefined();
    const controller = new AbortController();
    const pending = probe!("http://10.0.0.1:9999/api/identity", controller.signal);
    const requestId = network.probeIdentity.mock.calls[0][1];
    controller.abort();
    expect(network.cancelProbe).toHaveBeenCalledWith(requestId);
    finish({ status: 200, body: null });
    await pending;
    expect(network.cancelProbe).toHaveBeenCalledTimes(1);
  });
});
