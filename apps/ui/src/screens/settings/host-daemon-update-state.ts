import { useCallback, useState, type MutableRefObject } from "react";
import type {
  DaemonUpdateChannel,
  DaemonUpdateCheckResponse,
  DaemonUpdateRun,
} from "@fde/protocol/messages";
import type { useHostRuntimeClient } from "@/runtime/host-runtime";

/** State shapes and the check hook behind the host settings "Daemon updates" section. */
export type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "checked"; result: DaemonUpdateCheckResponse["payload"] }
  | { kind: "error"; message: string };

export type RunState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; run: DaemonUpdateRun }
  | { kind: "reconnecting"; run: DaemonUpdateRun }
  | { kind: "error"; message: string };

type DaemonClient = ReturnType<typeof useHostRuntimeClient>;

export function useDaemonUpdateCheck(
  daemonClient: DaemonClient,
  channel: DaemonUpdateChannel,
  mounted: MutableRefObject<boolean>,
) {
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const runCheck = useCallback(() => {
    if (!daemonClient) return;
    setCheck({ kind: "checking" });
    daemonClient
      .checkDaemonUpdate({ channel })
      .then((result) => {
        if (mounted.current) setCheck({ kind: "checked", result });
        return undefined;
      })
      .catch((error: unknown) => {
        if (mounted.current) {
          setCheck({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
  }, [channel, daemonClient, mounted]);
  const resetCheck = useCallback(() => setCheck({ kind: "idle" }), []);
  return { check, runCheck, resetCheck };
}
