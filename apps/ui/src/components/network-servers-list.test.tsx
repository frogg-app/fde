// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/resources/en";
import { NetworkServersList } from "./network-servers-list";
import type { DiscoveredServer } from "@/network-scan/types";

const mocks = vi.hoisted(() => ({ hints: vi.fn(), probe: vi.fn() }));
vi.mock("@/network-scan/local-addresses", () => ({
  readLocalNetworkHints: mocks.hints,
  readShellProbe: () => undefined,
  reverseLookupHostname: async () => null,
}));
vi.mock("@/network-scan/probe", () => ({ probeDaemon: mocks.probe }));
vi.mock("@/network-scan/subnets", () => ({
  resolveCandidateSubnets: () => ["10.0.0"],
  buildProbeTargets: () => [
    { ip: "10.0.0.1", port: 9999 },
    { ip: "10.0.0.2", port: 9999 },
  ],
  subnetOf: () => "10.0.0",
  parseIpv4: (ip: string) => ip.split(".").map(Number),
}));
vi.mock("./add-host-connection-errors", () => ({ formatConnectionFailureMessage: vi.fn() }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostMutations: () => ({ probeAndUpsertDirectConnection: vi.fn() }),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("lucide-react-native", () => ({ RefreshCw: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: React.PropsWithChildren<{ onPress: () => void }>) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
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
const i18n = createInstance();
await i18n.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
function renderList() {
  return render(
    <I18nextProvider i18n={i18n}>
      <NetworkServersList onConnected={vi.fn()} />
    </I18nextProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  mocks.hints.mockReset().mockResolvedValue({ localAddresses: ["10.0.0.3/24"] });
  mocks.probe.mockReset();
});

describe("NetworkServersList", () => {
  it("cancels from the visible control, retains discoveries, and starts a fresh scan", async () => {
    let finish!: (server: DiscoveredServer | null) => void;
    let signal!: AbortSignal;
    mocks.probe.mockResolvedValueOnce(found).mockImplementationOnce((_target, options) => {
      signal = options.signal;
      return new Promise<DiscoveredServer | null>((resolve) => {
        finish = resolve;
      });
    });
    const { container } = renderList();
    await screen.findByText("dev");
    expect(screen.getByText("Scanning…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.getByText("Scan cancelled.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeTruthy();
    expect(container.textContent).not.toMatch(
      /Local addresses|First error|Scanned .*addresses via/,
    );

    mocks.probe.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    await screen.findByText("Scanning…");
    expect(screen.queryByText("Scan cancelled.")).toBeNull();
    expect(screen.queryByText("dev")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    await act(async () => finish(found));
    expect(screen.queryByText("dev")).toBeNull();
  });

  it("shows a concise scan failure with a working retry", async () => {
    mocks.hints.mockRejectedValueOnce(
      new Error("Error invoking remote method fde:networkProbeIdentity: internal detail"),
    );
    mocks.probe.mockResolvedValue(null);
    const { container } = renderList();
    await screen.findByText("Unable to scan. Try again.");
    expect(container.textContent).not.toContain("internal detail");
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    await waitFor(() => expect(screen.getByText("No servers found.")).toBeTruthy());
    expect(screen.queryByText("Unable to scan. Try again.")).toBeNull();
    expect(container.querySelector('[data-testid="network-scan-diagnostics"]')).toBeNull();
  });
});
