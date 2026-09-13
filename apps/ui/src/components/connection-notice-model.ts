import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

/** Short blips (a socket swap, a quick probe) should not flash a card. */
export const CONNECTION_NOTICE_SHOW_DELAY_MS = 1_000;
export const RECONNECTED_NOTICE_DURATION_MS = 2_500;

export interface ConnectionNoticeHostInput {
  serverId: string;
  label: string;
  status: HostRuntimeConnectionStatus;
  statusSince: number | null;
}

export interface ConnectionNotice {
  serverId: string;
  label: string;
  kind: "offline" | "reconnected";
  /** When the current state began: offline start, or reconnect time. */
  since: number;
  /** When the card becomes visible. */
  showAt: number;
}

/**
 * Only hosts this client has seen online can "lose" their connection; a saved host that was never
 * reachable is the host list's concern, not an interruption. `seenOnline` is mutated.
 */
export function reconcileConnectionNotices(input: {
  previous: readonly ConnectionNotice[];
  hosts: readonly ConnectionNoticeHostInput[];
  seenOnline: Set<string>;
  now: number;
}): ConnectionNotice[] {
  const previousById = new Map(input.previous.map((notice) => [notice.serverId, notice]));
  const next: ConnectionNotice[] = [];
  for (const host of input.hosts) {
    const previous = previousById.get(host.serverId);
    if (host.status === "online") {
      input.seenOnline.add(host.serverId);
      if (previous?.kind === "offline" && input.now >= previous.showAt) {
        next.push({
          serverId: host.serverId,
          label: host.label,
          kind: "reconnected",
          since: input.now,
          showAt: input.now,
        });
      } else if (
        previous?.kind === "reconnected" &&
        input.now - previous.since < RECONNECTED_NOTICE_DURATION_MS
      ) {
        next.push({ ...previous, label: host.label });
      }
      continue;
    }
    if (!input.seenOnline.has(host.serverId) || host.status === "idle") {
      continue;
    }
    if (previous?.kind === "offline") {
      next.push({ ...previous, label: host.label });
      continue;
    }
    const since = host.statusSince ?? input.now;
    next.push({
      serverId: host.serverId,
      label: host.label,
      kind: "offline",
      since,
      showAt: since + CONNECTION_NOTICE_SHOW_DELAY_MS,
    });
  }
  return next;
}

export function formatOfflineDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
