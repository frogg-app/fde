import { describe, expect, it } from "vitest";
import {
  AgentAttentionRequiredMessageSchema,
  NotificationAudioRequestSchema,
  NotificationAudioResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  StatusMessageSchema,
} from "./messages.js";
import { notificationAudioPath, withSpokenNotification } from "./agent-attention-notification.js";

const textOnlyNotification = {
  title: "Agent finished",
  body: "Done.",
  data: { serverId: "srv", workspaceId: "ws", agentId: "agent", reason: "finished" as const },
};

describe("spoken notification wire schema", () => {
  it("still parses the text-only attention payload an older daemon sends", () => {
    const parsed = AgentAttentionRequiredMessageSchema.parse({
      type: "agent_attention_required",
      payload: {
        agentId: "agent",
        reason: "finished",
        timestamp: "2026-09-03T00:00:00.000Z",
        shouldNotify: true,
        notification: textOnlyNotification,
      },
    });
    expect(parsed.payload.notification?.spokenText).toBeUndefined();
    expect(parsed.payload.notification?.audioUrl).toBeUndefined();
  });

  it("carries the spoken alert in both the payload and the push data", () => {
    const spoken = withSpokenNotification(textOnlyNotification, {
      id: "n1",
      spokenText: "Agent finished: Done.",
      audioUrl: notificationAudioPath("n1"),
    });
    const parsed = AgentAttentionRequiredMessageSchema.parse({
      type: "agent_attention_required",
      payload: {
        agentId: "agent",
        reason: "finished",
        timestamp: "2026-09-03T00:00:00.000Z",
        shouldNotify: true,
        notification: spoken,
      },
    });
    expect(parsed.payload.notification).toEqual({
      ...textOnlyNotification,
      id: "n1",
      spokenText: "Agent finished: Done.",
      audioUrl: "/api/notifications/n1/audio",
      data: {
        ...textOnlyNotification.data,
        notificationId: "n1",
        spokenText: "Agent finished: Done.",
        audioUrl: "/api/notifications/n1/audio",
      },
    });
  });

  it("encodes the notification id in the audio path", () => {
    expect(notificationAudioPath("a/b c")).toBe("/api/notifications/a%2Fb%20c/audio");
  });

  it("round-trips the notification audio RPC through the session unions", () => {
    const request = SessionInboundMessageSchema.parse({
      type: "notification.audio.request",
      requestId: "r1",
      notificationId: "n1",
    });
    expect(NotificationAudioRequestSchema.parse(request)).toEqual(request);

    const response = SessionOutboundMessageSchema.parse({
      type: "notification.audio.response",
      payload: {
        requestId: "r1",
        notificationId: "n1",
        audio: { base64: "UklGRg==", mimeType: "audio/wav" },
      },
    });
    expect(NotificationAudioResponseSchema.parse(response)).toEqual(response);

    const missing = NotificationAudioResponseSchema.parse({
      type: "notification.audio.response",
      payload: { requestId: "r1", notificationId: "n1", audio: null },
    });
    expect(missing.payload.audio).toBeNull();
  });

  it("advertises spoken notifications as an optional server_info feature", () => {
    const withFlag = StatusMessageSchema.parse({
      type: "status",
      payload: {
        status: "server_info",
        serverId: "srv",
        features: { spokenNotifications: true },
      },
    });
    expect(withFlag.payload).toMatchObject({ features: { spokenNotifications: true } });

    const withoutFlag = StatusMessageSchema.parse({
      type: "status",
      payload: { status: "server_info", serverId: "srv", features: {} },
    });
    expect(withoutFlag.payload).toMatchObject({ features: {} });
  });
});
