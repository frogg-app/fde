import {
  appendSelfUpdateLog,
  pruneVersions,
  readCurrentVersion,
  setCurrentVersion,
  writeLastUpdate,
  writePreviousVersion,
  type LastUpdateRecord,
} from "./layout.js";
import type { ServiceManager } from "./service.js";
import { waitForDaemonVersion, type DaemonProbe, type VerifyResult } from "./verify.js";

/**
 * The supervisor step, run by the detached `fde daemon self-update --apply`
 * process: flip `current`, restart, verify; on failure flip back to
 * `previous`, restart, verify again. Whatever happens ends in
 * `last-update.json` so the daemon and the CLI can report it afterwards.
 */
export interface ApplyPlan {
  installDir: string;
  version: string;
  previous: string | null;
  httpBase: string | null;
  verifyTimeoutMs?: number;
}

export interface ApplyDependencies {
  service: ServiceManager;
  probe?: DaemonProbe;
  log?: (line: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export type ApplyOutcome = LastUpdateRecord;

async function restartAndVerify(
  plan: ApplyPlan,
  deps: ApplyDependencies,
  version: string,
  log: (line: string) => void,
): Promise<VerifyResult> {
  try {
    await deps.service.restart();
  } catch (error) {
    return { ok: false, reason: `restart failed: ${error instanceof Error ? error.message : error}` };
  }
  if (!plan.httpBase) {
    log(`no TCP listen address to verify; assuming ${version} is up`);
    return { ok: true, elapsedMs: 0 };
  }
  return waitForDaemonVersion(
    {
      httpBase: plan.httpBase,
      expectedVersion: version,
      timeoutMs: plan.verifyTimeoutMs,
      isRunning: () => deps.service.isRunning(),
      sleep: deps.sleep,
    },
    deps.probe,
  );
}

export async function applyUpdate(plan: ApplyPlan, deps: ApplyDependencies): Promise<ApplyOutcome> {
  const log = deps.log ?? ((line: string) => appendSelfUpdateLog(plan.installDir, line));
  const now = deps.now ?? (() => new Date());
  const finish = (record: ApplyOutcome): ApplyOutcome => {
    writeLastUpdate(plan.installDir, record);
    log(`${record.status}: ${record.from ?? "?"} -> ${record.to}${record.reason ? ` (${record.reason})` : ""}`);
    return record;
  };

  const from = readCurrentVersion(plan.installDir);
  const previous = plan.previous ?? from;
  log(`applying ${plan.version} (current ${from ?? "none"}, previous ${previous ?? "none"}, service ${deps.service.kind})`);

  try {
    if (from !== plan.version) {
      writePreviousVersion(plan.installDir, previous);
      setCurrentVersion(plan.installDir, plan.version);
    }
  } catch (error) {
    return finish({
      from,
      to: plan.version,
      status: "failed",
      reason: `could not switch current: ${error instanceof Error ? error.message : error}`,
      at: now().toISOString(),
    });
  }

  log(`restarting daemon into ${plan.version}`);
  const verified = await restartAndVerify(plan, deps, plan.version, log);
  if (verified.ok) {
    const removed = pruneVersions(plan.installDir, { protect: [plan.version, previous] });
    if (removed.length > 0) log(`pruned ${removed.join(", ")}`);
    return finish({ from, to: plan.version, status: "applied", reason: null, at: now().toISOString() });
  }

  log(`update to ${plan.version} failed: ${verified.reason}`);
  if (!previous || previous === plan.version) {
    return finish({
      from,
      to: plan.version,
      status: "failed",
      reason: `${verified.reason}; no previous version to roll back to`,
      at: now().toISOString(),
    });
  }

  log(`rolling back to ${previous}`);
  try {
    setCurrentVersion(plan.installDir, previous);
  } catch (error) {
    return finish({
      from,
      to: plan.version,
      status: "failed",
      reason: `${verified.reason}; rollback could not switch current: ${error instanceof Error ? error.message : error}`,
      at: now().toISOString(),
    });
  }
  const rolledBack = await restartAndVerify(plan, deps, previous, log);
  if (rolledBack.ok) {
    return finish({
      from,
      to: plan.version,
      status: "rolled_back",
      reason: verified.reason,
      at: now().toISOString(),
    });
  }
  return finish({
    from,
    to: plan.version,
    status: "failed",
    reason: `${verified.reason}; rollback to ${previous} also failed: ${rolledBack.reason}`,
    at: now().toISOString(),
  });
}
