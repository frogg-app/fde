import type { ServerCapabilityState } from "@fde/protocol/messages";
import type { DaemonServerInfo } from "@/stores/session-store";

/**
 * Whether this daemon can run a Companion session right now.
 *
 * The daemon resolves `capabilities.companion` from `features.companion.enabled`
 * plus a resolvable Anthropic key, so an advertised capability means the runtime
 * can actually answer rather than merely that the handler exists. The app never
 * shows a control the daemon cannot honour — see docs/companion.md § Protocol.
 */
export function getCompanionReadiness(
  serverInfo: DaemonServerInfo | null | undefined,
): ServerCapabilityState | null {
  return serverInfo?.capabilities?.companion ?? null;
}

export function isCompanionAvailable(serverInfo: DaemonServerInfo | null | undefined): boolean {
  return getCompanionReadiness(serverInfo)?.enabled === true;
}

/** The daemon's own words for why it is unavailable, or null when it is fine. */
export function companionUnavailableReason(
  serverInfo: DaemonServerInfo | null | undefined,
): string | null {
  const readiness = getCompanionReadiness(serverInfo);
  if (!readiness || readiness.enabled) {
    return null;
  }
  const reason = readiness.reason.trim();
  return reason.length > 0 ? reason : null;
}
