import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DAEMON_PORT } from "@/constants/daemon-port";
import { readLocalNetworkHints, reverseLookupHostname } from "./local-addresses";
import { probeDaemon } from "./probe";
import { mergeScanResults, scanNetwork } from "./scanner";
import { buildProbeTargets, resolveCandidateSubnets } from "./subnets";
import type { DiscoveredServer, ScanProgress, ScanStatus } from "./types";

export interface NetworkScanState {
  status: ScanStatus;
  progress: ScanProgress;
  subnets: string[];
  servers: DiscoveredServer[];
}

const INITIAL_STATE: NetworkScanState = {
  status: "idle",
  progress: { scanned: 0, total: 0 },
  subnets: [],
  servers: [],
};

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
      setState((current) => ({
        ...current,
        subnets,
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
        probe: (target, probeOptions) => probeDaemon(target, probeOptions),
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
