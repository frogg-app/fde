import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRequireBearerMiddleware, hashDaemonPassword } from "../auth.js";
import { NOTIFICATION_AUDIO_ROUTE, createNotificationAudioHandler } from "./audio-route.js";
import type { SpokenAlertService } from "./spoken-alerts.js";

const PASSWORD = "correct-horse";

function createFakeSpokenAlerts(): SpokenAlertService {
  return {
    isAvailable: () => true,
    prepare: () => true,
    async read(id) {
      if (id !== "known") return null;
      return { bytes: Buffer.from("RIFF-fake-wav"), mimeType: "audio/wav" };
    },
  };
}

let baseUrl: string;
let close: () => Promise<void>;

beforeEach(async () => {
  const app = express();
  app.use(createRequireBearerMiddleware({ password: hashDaemonPassword(PASSWORD) }));
  app.get(NOTIFICATION_AUDIO_ROUTE, (req, res) => {
    void createNotificationAudioHandler(createFakeSpokenAlerts())(req, res);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  close = promisify(server.close.bind(server));
});

afterEach(async () => {
  await close();
});

describe("GET /api/notifications/:id/audio", () => {
  it("rejects requests without the daemon bearer", async () => {
    const response = await fetch(`${baseUrl}/api/notifications/known/audio`);
    expect(response.status).toBe(401);
  });

  it("rejects a wrong bearer", async () => {
    const response = await fetch(`${baseUrl}/api/notifications/known/audio`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(response.status).toBe(401);
  });

  it("streams the cached audio with its mime type for an authenticated caller", async () => {
    const response = await fetch(`${baseUrl}/api/notifications/known/audio`, {
      headers: { authorization: `Bearer ${PASSWORD}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("RIFF-fake-wav");
  });

  it("answers 404 for a notification without audio", async () => {
    const response = await fetch(`${baseUrl}/api/notifications/unknown/audio`, {
      headers: { authorization: `Bearer ${PASSWORD}` },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No audio for this notification" });
  });
});
