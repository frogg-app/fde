import { describe, expect, test } from "vitest";
import {
  collectDesktopDiagnosticSections,
  type DesktopDiagnosticSources,
} from "./desktop-diagnostic-report";

function makeSources(): DesktopDiagnosticSources {
  return {
    getStatus: async () => ({
      serverId: "server-1",
      status: "running",
      listen: "127.0.0.1:9999",
      hostname: "host",
      pid: 4242,
      home: "/fde/home",
      version: "1.2.3",
      desktopManaged: true,
      error: null,
    }),
    getDaemonLogs: async () => ({
      logPath: "/fde/home/daemon.log",
      contents: "daemon line one\ndaemon line two",
    }),
    getAppLogs: async () => ({
      logPath: "/logs/Fde/main.log",
      contents: "[login-shell-env] start\n[login-shell-env] failed",
    }),
  };
}

describe("desktop diagnostic report", () => {
  test("collects app logs without requesting a daemon in app-only shells", async () => {
    const result = await collectDesktopDiagnosticSections({
      ...makeSources(),
      supportsLocalDaemon: () => false,
      getStatus: async () => {
        throw new Error("must not request daemon status");
      },
      getDaemonLogs: async () => {
        throw new Error("must not request daemon logs");
      },
    });
    expect(result.status).toBe("done");
    expect(result.sections).toEqual([
      "Desktop app log tail\n  [login-shell-env] start\n  [login-shell-env] failed",
    ]);
  });

  test("starts desktop diagnostic requests together", async () => {
    const calls: string[] = [];
    let releaseAppLogs: () => void = () => {};
    const appLogGate = new Promise<void>((resolve) => {
      releaseAppLogs = resolve;
    });
    const sources: DesktopDiagnosticSources = {
      ...makeSources(),
      getStatus: async () => {
        calls.push("status");
        return makeSources().getStatus();
      },
      getDaemonLogs: async () => {
        calls.push("daemonLogs");
        return makeSources().getDaemonLogs();
      },
      getAppLogs: async () => {
        calls.push("appLogs");
        await appLogGate;
        return makeSources().getAppLogs();
      },
    };

    const resultPromise = collectDesktopDiagnosticSections(sources);

    expect(calls).toEqual(["status", "daemonLogs", "appLogs"]);
    releaseAppLogs();
    await expect(resultPromise).resolves.toMatchObject({ status: "done" });
  });

  test("includes the Electron main-process log after the daemon log", async () => {
    const result = await collectDesktopDiagnosticSections(makeSources());
    const report = result.sections.join("\n\n");

    expect(result.status).toBe("done");
    expect(report).toContain("  Log path: /fde/home/daemon.log");
    expect(report).toContain("  App log path: /logs/Fde/main.log");
    expect(report).toContain("Desktop daemon log tail\n  daemon line one\n  daemon line two");
    expect(report).toContain(
      "Desktop app log tail\n  [login-shell-env] start\n  [login-shell-env] failed",
    );
    expect(report.indexOf("Desktop app log tail")).toBeGreaterThan(
      report.indexOf("Desktop daemon log tail"),
    );
  });

  test("keeps daemon diagnostics when the Electron app log fails", async () => {
    const sources = {
      ...makeSources(),
      getAppLogs: async () => {
        throw new Error("app log unavailable");
      },
    };

    const result = await collectDesktopDiagnosticSections(sources);
    const report = result.sections.join("\n\n");

    expect(result.status).toBe("failed");
    expect(report).toContain("Desktop daemon log tail\n  daemon line one\n  daemon line two");
    expect(report).toContain("Desktop app log tail\n  Error: app log unavailable");
  });
});
