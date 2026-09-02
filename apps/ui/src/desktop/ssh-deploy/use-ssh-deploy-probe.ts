import { useCallback } from "react";
import { useFetchQuery } from "@/data/query";
import {
  probeSshDeploy,
  type SshDeployProbe,
  type SshDeployTarget,
} from "@/desktop/ssh-deploy/ssh-deploy";

export type SshDeployProbeState =
  | { status: "probing" }
  | { status: "ready"; probe: SshDeployProbe }
  | { status: "failed"; error: string };

export interface SshDeployProbeQuery {
  state: SshDeployProbeState;
  refresh: () => void;
}

/** Probes the host once per target; `refresh` re-runs it (after a deploy). */
export function useSshDeployProbe(
  target: SshDeployTarget | null,
  enabled: boolean = true,
): SshDeployProbeQuery {
  const host = target?.host ?? "";
  const sshPort = target?.sshPort ?? null;
  const { data, error, isFetching, refetch } = useFetchQuery<SshDeployProbe>({
    queryKey: ["desktop", "ssh-deploy-probe", host, sshPort],
    queryFn: () => probeSshDeploy({ host, ...(sshPort !== null ? { sshPort } : {}) }),
    dataShape: "value",
    staleTimeMs: 15_000,
    retry: false,
    enabled: enabled && host.length > 0,
  });
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  let state: SshDeployProbeState;
  if (data && !isFetching) {
    state = { status: "ready", probe: data };
  } else if (error && !isFetching) {
    state = { status: "failed", error: error instanceof Error ? error.message : String(error) };
  } else {
    state = { status: "probing" };
  }
  return { state, refresh };
}
