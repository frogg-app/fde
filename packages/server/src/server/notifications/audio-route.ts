import type { Express, Request, Response } from "express";
import type { Logger } from "pino";

import type { SpokenAlertService } from "./spoken-alerts.js";

export const NOTIFICATION_AUDIO_ROUTE = "/api/notifications/:id/audio";

export function mountNotificationAudioRoute(params: {
  app: Express;
  spokenAlerts: SpokenAlertService;
  logger: Logger;
}): void {
  const handler = createNotificationAudioHandler(params.spokenAlerts);
  params.app.get(NOTIFICATION_AUDIO_ROUTE, (req, res) => {
    handler(req, res).catch((err) => {
      params.logger.error({ err }, "Failed to serve notification audio");
      if (!res.headersSent) res.status(500).json({ error: "Failed to read audio" });
    });
  });
}

/**
 * Serves cached alert audio. Mounted after the daemon's bearer middleware, so a caller
 * needs the same credential the app uses for everything else; a push notification only
 * carries the path, never a capability token.
 */
export function createNotificationAudioHandler(
  spokenAlerts: SpokenAlertService,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (id.length === 0) {
      res.status(400).json({ error: "Missing notification id" });
      return;
    }
    const entry = await spokenAlerts.read(id);
    if (!entry) {
      res.status(404).json({ error: "No audio for this notification" });
      return;
    }
    res.setHeader("Content-Type", entry.mimeType);
    res.setHeader("Content-Length", entry.bytes.length.toString());
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(entry.bytes);
  };
}
