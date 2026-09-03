import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  IDLE_APP_UPDATE_PROGRESS,
  appUpdateProgressFraction,
  describeAppUpdateProgress,
  describeInstallKind,
  formatAppUpdateProgress,
  parseAppUpdateProgressEvent,
  reduceAppUpdateProgress,
  type AppUpdateProgress,
} from "./app-update-progress";

describe("app update progress", () => {
  it("parses shell events defensively", () => {
    expect(
      parseAppUpdateProgressEvent({ phase: "download", received: 10, total: 100, asset: "x" }),
    ).toEqual({ phase: "download", received: 10, total: 100, detail: null });
    expect(parseAppUpdateProgressEvent({ phase: "verify", received: 5 })).toEqual({
      phase: "verify",
      received: 5,
      total: null,
      detail: null,
    });
    expect(parseAppUpdateProgressEvent({ phase: "error", detail: "boom" })).toMatchObject({
      phase: "error",
      detail: "boom",
    });
    expect(parseAppUpdateProgressEvent({ phase: "weird", received: -1 })).toEqual({
      phase: "download",
      received: null,
      total: null,
      detail: null,
    });
    expect(parseAppUpdateProgressEvent(null).phase).toBe("error");
  });

  it("reduces events into progress and keeps the last known total", () => {
    const downloading = reduceAppUpdateProgress(IDLE_APP_UPDATE_PROGRESS, {
      phase: "download",
      received: 25,
      total: 100,
      detail: null,
    });
    expect(downloading).toEqual({ status: "active", phase: "download", received: 25, total: 100 });
    expect(appUpdateProgressFraction(downloading)).toBe(0.25);
    expect(formatAppUpdateProgress(downloading)).toBe("25 B / 100 B");

    const unknownTotal = reduceAppUpdateProgress(downloading, {
      phase: "download",
      received: 50,
      total: null,
      detail: null,
    });
    expect(unknownTotal).toMatchObject({ received: 50, total: 100 });

    const verifying = reduceAppUpdateProgress(unknownTotal, {
      phase: "verify",
      received: 100,
      total: 100,
      detail: null,
    });
    expect(appUpdateProgressFraction(verifying)).toBe(1);
    expect(formatAppUpdateProgress(verifying)).toBeNull();

    expect(
      reduceAppUpdateProgress(verifying, {
        phase: "error",
        received: null,
        total: null,
        detail: "x",
      }),
    ).toEqual({ status: "error", message: "x" });
    expect(appUpdateProgressFraction(IDLE_APP_UPDATE_PROGRESS)).toBeNull();
    const indeterminate: AppUpdateProgress = {
      status: "active",
      phase: "download",
      received: 3,
      total: null,
    };
    expect(appUpdateProgressFraction(indeterminate)).toBeNull();
    expect(formatAppUpdateProgress(indeterminate)).toBe("3 B");
  });

  it("describes phases and install kinds in the active language", async () => {
    expect(
      describeAppUpdateProgress({
        status: "active",
        phase: "download",
        received: 1024,
        total: 2048,
      }),
    ).toBe("Downloading 1 KB / 2 KB");
    expect(
      describeAppUpdateProgress({ status: "active", phase: "verify", received: 1, total: 1 }),
    ).toBe("Verifying download...");
    expect(describeAppUpdateProgress(IDLE_APP_UPDATE_PROGRESS)).toBe("");
    expect(describeInstallKind("linux-deb")).toBe(
      "Opens the .deb package in your package installer.",
    );
    expect(describeInstallKind(null)).toBe("Downloads the release built for this platform.");

    await i18n.changeLanguage("fr");
    try {
      expect(describeInstallKind("macos-dmg")).not.toBe(
        "Opens the disk image; drag FDE to Applications to finish.",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
