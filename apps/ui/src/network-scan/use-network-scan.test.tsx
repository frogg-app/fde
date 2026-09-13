// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNetworkScan } from "./use-network-scan";
import type { DiscoveredServer } from "./types";

const mocks = vi.hoisted(() => ({ hints: vi.fn(), probe: vi.fn() }));
vi.mock("./local-addresses", () => ({
  readLocalNetworkHints: mocks.hints,
  readShellProbe: () => undefined,
  reverseLookupHostname: async () => null,
}));
vi.mock("./probe", () => ({ probeDaemon: mocks.probe }));
vi.mock("./subnets", () => ({
  resolveCandidateSubnets: () => ["10.0.0"],
  buildProbeTargets: () => [
    { ip: "10.0.0.1", port: 9999 },
    { ip: "10.0.0.2", port: 9999 },
  ],
  subnetOf: () => "10.0.0",
  parseIpv4: (ip: string) => ip.split(".").map(Number),
}));
const found: DiscoveredServer = {
  ip: "10.0.0.1",
  port: 9999,
  endpoint: "10.0.0.1:9999",
  hostname: "dev",
  version: "1",
  serverId: "srv",
  source: "identity",
  pairingRequired: false,
};

describe("useNetworkScan", () => {
  beforeEach(() => {
    mocks.hints.mockReset().mockResolvedValue({ localAddresses: ["10.0.0.3/24"] });
    mocks.probe.mockReset().mockResolvedValue(null);
  });
  it("finishes successfully and can scan again", async () => {
    mocks.probe.mockResolvedValue(found);
    const { result } = renderHook(() => useNetworkScan());
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.servers).toEqual([found]);
    act(() => result.current.rescan());
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.status).toBe("done"));
  });
  it("cancels active work, preserves discoveries, and ignores late results after retry", async () => {
    let finish!: (server: DiscoveredServer) => void;
    let activeSignal!: AbortSignal;
    mocks.probe.mockResolvedValueOnce(found).mockImplementationOnce((_target, options) => {
      activeSignal = options.signal;
      return new Promise<DiscoveredServer>((resolve) => {
        finish = resolve;
      });
    });
    const { result } = renderHook(() => useNetworkScan());
    await waitFor(() => expect(result.current.servers).toEqual([found]));
    act(() => result.current.cancel());
    expect(activeSignal.aborted).toBe(true);
    expect(result.current.status).toBe("cancelled");
    expect(result.current.servers).toEqual([found]);
    act(() => result.current.rescan());
    await waitFor(() => expect(result.current.status).toBe("done"));
    await act(async () => finish({ ...found, endpoint: "late:9999" }));
    expect(result.current.servers).toEqual([]);
    expect(result.current.status).toBe("done");
  });
  it("shows a recoverable scan failure", async () => {
    mocks.hints.mockRejectedValueOnce(new Error("unavailable"));
    const { result } = renderHook(() => useNetworkScan());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    act(() => result.current.rescan());
    await waitFor(() => expect(result.current.status).toBe("done"));
  });
  it("aborts probes when unmounted", async () => {
    const signals: AbortSignal[] = [];
    mocks.probe.mockImplementation((_target, options) => {
      signals.push(options.signal);
      return new Promise(() => undefined);
    });
    const { unmount } = renderHook(() => useNetworkScan());
    await waitFor(() => expect(signals).toHaveLength(2));
    unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
