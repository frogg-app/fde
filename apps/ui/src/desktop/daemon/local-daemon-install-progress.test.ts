import { describe, expect, it } from "vitest";
import {
  IDLE_INSTALL_PROGRESS,
  formatBytes,
  formatInstallProgress,
  installProgressFraction,
  parseLocalDaemonInstallEvent,
  reduceLocalDaemonInstallProgress,
  type LocalDaemonInstallProgress,
} from "./local-daemon-install-progress";

describe("parseLocalDaemonInstallEvent", () => {
  it("normalises the shell payload", () => {
    expect(
      parseLocalDaemonInstallEvent({
        kind: "progress",
        received: 5,
        total: 10,
        detail: "download",
      }),
    ).toEqual({ kind: "progress", received: 5, total: 10, detail: "download", version: null });
    expect(parseLocalDaemonInstallEvent({ kind: "done", version: "0.1.7" })).toMatchObject({
      kind: "done",
      version: "0.1.7",
    });
    expect(parseLocalDaemonInstallEvent({ kind: "progress", total: null })).toMatchObject({
      received: null,
      total: null,
    });
  });

  it("treats garbage as an error", () => {
    expect(parseLocalDaemonInstallEvent("nope").kind).toBe("error");
    expect(parseLocalDaemonInstallEvent({ kind: "weird", detail: "x" })).toMatchObject({
      kind: "error",
      detail: "x",
    });
  });
});

describe("reduceLocalDaemonInstallProgress", () => {
  it("walks idle -> installing -> done", () => {
    const downloading = reduceLocalDaemonInstallProgress(IDLE_INSTALL_PROGRESS, {
      kind: "progress",
      received: 1024,
      total: 4096,
      detail: "download",
    });
    expect(downloading).toEqual({
      status: "installing",
      phase: "download",
      received: 1024,
      total: 4096,
    });
    const extracting = reduceLocalDaemonInstallProgress(downloading, {
      kind: "progress",
      received: 4096,
      total: 4096,
      detail: "extract",
    });
    expect(extracting).toMatchObject({ status: "installing", phase: "extract" });
    expect(
      reduceLocalDaemonInstallProgress(extracting, { kind: "done", version: "1.0.0" }),
    ).toEqual({ status: "done", version: "1.0.0" });
  });

  it("carries the error detail", () => {
    expect(
      reduceLocalDaemonInstallProgress(IDLE_INSTALL_PROGRESS, {
        kind: "error",
        detail: "checksum mismatch",
      }),
    ).toEqual({ status: "error", message: "checksum mismatch" });
    expect(reduceLocalDaemonInstallProgress(IDLE_INSTALL_PROGRESS, { kind: "error" })).toEqual({
      status: "error",
      message: "Install failed.",
    });
  });
});

describe("installProgressFraction and formatting", () => {
  it("is indeterminate without a total and complete while extracting", () => {
    expect(installProgressFraction(IDLE_INSTALL_PROGRESS)).toBeNull();
    const unknownTotal: LocalDaemonInstallProgress = {
      status: "installing",
      phase: "download",
      received: 10,
      total: null,
    };
    expect(installProgressFraction(unknownTotal)).toBeNull();
    expect(
      installProgressFraction({ status: "installing", phase: "download", received: 5, total: 20 }),
    ).toBe(0.25);
    expect(
      installProgressFraction({ status: "installing", phase: "extract", received: 20, total: 20 }),
    ).toBe(1);
    expect(installProgressFraction({ status: "done", version: null })).toBe(1);
  });

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(180 * 1024 * 1024)).toBe("180 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
    expect(
      formatInstallProgress({
        status: "installing",
        phase: "download",
        received: 42 * 1024 * 1024,
        total: 180 * 1024 * 1024,
      }),
    ).toBe("42 MB / 180 MB");
    expect(
      formatInstallProgress({
        status: "installing",
        phase: "download",
        received: 42 * 1024 * 1024,
        total: null,
      }),
    ).toBe("42 MB");
    expect(
      formatInstallProgress({ status: "installing", phase: "extract", received: 1, total: 1 }),
    ).toBeNull();
  });
});
