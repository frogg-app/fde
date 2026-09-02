import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopEventUnlisten } from "@/desktop/electron/events";
import {
  cancelSshDeploy,
  listenToSshDeployEvents,
  type SshDeployEvent,
} from "@/desktop/ssh-deploy/ssh-deploy";

export type SshDeployAction = "deploy" | "upgrade" | "reinstall" | "uninstall";

export type SshDeployJobState =
  | { status: "idle" }
  | { status: "running"; action: SshDeployAction; jobId: string | null }
  | { status: "done"; action: SshDeployAction }
  | { status: "failed"; action: SshDeployAction; detail: string; cancelled: boolean };

export interface SshDeployJob {
  state: SshDeployJobState;
  lines: string[];
  /** Starts a job: `launch` invokes the desktop command and resolves its job id. */
  run: (action: SshDeployAction, launch: () => Promise<string>) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

const MAX_LINES = 2000;

/**
 * Drives one deploy/uninstall job at a time and mirrors its event stream.
 * The listener is attached before the command is sent, and events that
 * arrive before the job id is known are buffered, so no line is lost.
 */
export function useSshDeployJob(onFinished?: (action: SshDeployAction) => void): SshDeployJob {
  const [state, setState] = useState<SshDeployJobState>({ status: "idle" });
  const [lines, setLines] = useState<string[]>([]);
  const jobIdRef = useRef<string | null>(null);
  const pendingRef = useRef<SshDeployEvent[]>([]);
  const unlistenRef = useRef<DesktopEventUnlisten | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const detach = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    jobIdRef.current = null;
    pendingRef.current = [];
  }, []);

  useEffect(() => detach, [detach]);

  const apply = useCallback(
    (action: SshDeployAction, event: SshDeployEvent) => {
      if (event.kind === "log") {
        setLines((previous) => {
          const next = previous.length >= MAX_LINES ? previous.slice(1) : previous.slice();
          next.push(event.text);
          return next;
        });
        return;
      }
      detach();
      if (event.kind === "done") {
        setState({ status: "done", action });
        finishedRef.current?.(action);
        return;
      }
      setState({ status: "failed", action, detail: event.detail, cancelled: event.cancelled });
    },
    [detach],
  );

  const run = useCallback(
    async (action: SshDeployAction, launch: () => Promise<string>) => {
      if (unlistenRef.current) return;
      setLines([]);
      setState({ status: "running", action, jobId: null });
      try {
        unlistenRef.current = await listenToSshDeployEvents((event) => {
          if (jobIdRef.current === null) {
            pendingRef.current.push(event);
            return;
          }
          if (event.jobId === jobIdRef.current) apply(action, event);
        });
        const jobId = await launch();
        jobIdRef.current = jobId;
        setState({ status: "running", action, jobId });
        const buffered = pendingRef.current.filter((event) => event.jobId === jobId);
        pendingRef.current = [];
        for (const event of buffered) apply(action, event);
      } catch (error) {
        detach();
        const detail = error instanceof Error ? error.message : String(error);
        setState({ status: "failed", action, detail, cancelled: false });
      }
    },
    [apply, detach],
  );

  const cancel = useCallback(() => {
    const jobId = jobIdRef.current;
    if (jobId) void cancelSshDeploy(jobId).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    if (unlistenRef.current) return;
    setState({ status: "idle" });
    setLines([]);
  }, []);

  return { state, lines, run, cancel, reset };
}
