import type { AgentAttentionNotificationPayload } from "@fde/protocol/agent-attention-notification";
import { resolveNotificationTarget } from "@/utils/notification-routing";
import { alertKey, type SpokenAlert, type SpokenAlertReason } from "./state";
import { useSpokenAlertsStore } from "./store";

export interface ReceivedSpokenAlert {
  key: string;
  alert: SpokenAlert;
}

function record(alert: SpokenAlert): ReceivedSpokenAlert {
  useSpokenAlertsStore.getState().dispatch({ type: "received", alert });
  return { key: alertKey(alert.serverId, alert.agentId), alert };
}

/** Records the spoken alert carried by a live attention notification, if the daemon sent one. */
export function receiveSpokenAlert(params: {
  serverId: string;
  agentId: string;
  reason: SpokenAlertReason;
  timestamp: string;
  notification?: AgentAttentionNotificationPayload;
}): ReceivedSpokenAlert | null {
  const notification = params.notification;
  if (!notification?.id || !notification.spokenText) return null;
  const receivedAt = Date.parse(params.timestamp);
  return record({
    id: notification.id,
    serverId: params.serverId,
    agentId: params.agentId,
    workspaceId: notification.data.workspaceId ?? null,
    reason: params.reason,
    spokenText: notification.spokenText,
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
  });
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readReason(data: Record<string, unknown>): SpokenAlertReason {
  const value = data.reason;
  if (value === "error" || value === "permission") return value;
  return "finished";
}

/**
 * Records the spoken alert a tapped push notification carried, so the agent opens with its
 * banner ready to play even though the live attention message was never received.
 */
export function receiveSpokenAlertFromNotificationData(
  data: Record<string, unknown> | undefined,
): ReceivedSpokenAlert | null {
  if (!data) return null;
  const target = resolveNotificationTarget(data);
  const id = readString(data, "notificationId");
  const spokenText = readString(data, "spokenText");
  if (!target.serverId || !target.agentId || !id || !spokenText) return null;
  return record({
    id,
    serverId: target.serverId,
    agentId: target.agentId,
    workspaceId: target.workspaceId,
    reason: readReason(data),
    spokenText,
    receivedAt: Date.now(),
  });
}
