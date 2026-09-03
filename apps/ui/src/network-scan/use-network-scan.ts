import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DAEMON_PORT } from "@/constants/daemon-port";
import { readLocalNetworkHints, readShellProbe, reverseLookupHostname } from "./local-addresses";
import { probeDaemon } from "./probe";
import { mergeScanResults, scanNetwork } from "./scanner";
import { buildProbeTargets, resolveCandidateSubnets, subnetOf } from "./subnets";
import type { DiscoveredServer, ScanDiagnostics, ScanProgress, ScanStatus } from "./types";

export interface NetworkScanState {
  status: ScanStatus;
  progress: ScanProgress;
  subnets: string[];
  servers: DiscoveredServer[];
  diagnostics: ScanDiagnostics;
}

const INITIAL_DIAGNOSTICS: ScanDiagnostics = {
  localAddresses: [],
  localAddressesError: null,
  transport: "fetch",
  firstErrorBySubnet: {},
};

const INITIAL_STATE: NetworkScanState = {
  status: "idle",
  progress: { scanned: 0, total: 0 },
  subnets: [],
  servers: [],
  diagnostics: INITIAL_DIAGNOSTICS,
};

/** First transport error seen per subnet, in the order the subnets were probed. */
export function firstScanError(diagnostics: ScanDiagnostics): string | null {
  for (const message of Object.values(diagnostics.firstErrorBySubnet)) {
    if (message) return message;
  }
  return null;
}

const LOG_PREFIX = "[network-scan]";

/**
 * Sweeps the local /24 subnets for FDE daemons on the default port. Starts on
 * mount, aborts on unmount, and never throws: an unreachable network is just
 * an empty list. `rescan` restarts from scratch.
 */
export function useNetworkScan(
  options: { enabled?: boolean; port?: number } = {},
): NetworkScanState & {
  rescan: () => void;
} {
  const enabled = options.enabled ?? true;
  const port = options.port ?? DEFAULT_DAEMON_PORT;
  const [state, setState] = useState<NetworkScanState>(INITIAL_STATE);
  const [generation, setGeneration] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const rescan = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;

    setState({ ...INITIAL_STATE, status: "scanning" });

    const run = async () => {
      const hints = await readLocalNetworkHints();
      if (signal.aborted) return;
      const subnets = resolveCandidateSubnets(hints);
      const targets = buildProbeTargets(subnets, port);
      const shellProbe = readShellProbe();
      const diagnostics: ScanDiagnostics = {
        localAddresses: [...(hints.localAddresses ?? [])],
        localAddressesError: hints.localAddressesError ?? null,
        transport: shellProbe ? "shell" : "fetch",
        firstErrorBySubnet: {},
      };
      // The shell's fde.log does not carry console output, so this line is
      // what a bug report can quote; the card shows the same summary.
      console.info(
        `${LOG_PREFIX} local addresses: ${diagnostics.localAddresses.join(", ") || "(none)"}` +
          (diagnostics.localAddressesError ? ` (error: ${diagnostics.localAddressesError})` : "") +
          `; page host: ${hints.pageHost ?? "(none)"}; subnets: ${subnets.join(", ")}; ` +
          `transport: ${diagnostics.transport}; targets: ${targets.length}`,
      );
      setState((current) => ({
        ...current,
        subnets,
        diagnostics,
        progress: { scanned: 0, total: targets.length },
      }));

      const addServer = (server: DiscoveredServer) => {
        if (signal.aborted) return;
        setState((current) => ({
          ...current,
          servers: mergeScanResults(current.servers, [server]),
        }));
      };

      await scanNetwork({
        targets,
        signal,
        probe: (target, probeOptions) =>
          probeDaemon(target, {
            ...probeOptions,
            shellProbe,
            onError: (failed, message) => {
              const subnet = subnetOf(failed.ip) ?? failed.ip;
              if (subnet in diagnostics.firstErrorBySubnet) return;
              diagnostics.firstErrorBySubnet[subnet] = message;
              console.info(
                `${LOG_PREFIX} first error on ${subnet}.0/24 (${failed.ip}): ${message}`,
              );
              if (!signal.aborted) {
                setState((current) => ({
                  ...current,
                  diagnostics: {
                    ...current.diagnostics,
                    firstErrorBySubnet: { ...diagnostics.firstErrorBySubnet },
                  },
                }));
              }
            },
          }),
        onProgress: (progress) => {
          if (!signal.aborted) setState((current) => ({ ...current, progress }));
        },
        onServer: (server) => {
          addServer(server);
          if (server.hostname) return;
          void reverseLookupHostname(server.ip).then((hostname) => {
            if (hostname) addServer({ ...server, hostname });
            return null;
          });
        },
      });
      if (!signal.aborted) setState((current) => ({ ...current, status: "done" }));
    };

    void run().catch(() => {
      if (!signal.aborted) setState((current) => ({ ...current, status: "done" }));
    });

    return () => {
      controller.abort();
    };
  }, [enabled, generation, port]);

  return { ...state, rescan };
}
