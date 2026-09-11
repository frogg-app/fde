import type { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createCli } from "./cli.js";

// Exercise real Commander registration and parsing, intercepting only the final
// action so installed-service and updater argv cannot launch or mutate a daemon.
describe("installed daemon command compatibility", () => {
  it.each([
    {
      source: "systemd, launchd, and Docker foreground startup",
      argv: ["start", "--foreground"],
      options: { foreground: true },
    },
    {
      source: "desktop and smoke-test startup",
      argv: ["start", "--listen", "0.0.0.0:9999", "--no-relay", "--web-ui", "--home", "/test/fde"],
      options: { listen: "0.0.0.0:9999", relay: false, webUi: true, home: "/test/fde" },
    },
    {
      source: "desktop daemon health check",
      argv: ["status", "--home", "/test/fde", "--json"],
      options: { home: "/test/fde", json: true },
    },
    {
      source: "uninstaller and rollback shutdown",
      argv: ["stop", "--home", "/test/fde", "--force", "--json"],
      options: { home: "/test/fde", force: true, json: true },
    },
    {
      source: "rollback-test update invocation",
      argv: [
        "self-update",
        "--to",
        "0.2.10",
        "--home",
        "/test/fde",
        "--json",
        "--verify-timeout",
        "5",
      ],
      options: { to: "0.2.10", home: "/test/fde", json: true, verifyTimeout: "5" },
    },
    {
      source: "updater detached apply worker",
      argv: [
        "self-update",
        "--apply",
        "0.2.10",
        "--previous",
        "0.2.9",
        "--http-base",
        "http://localhost:9999",
      ],
      options: { apply: "0.2.10", previous: "0.2.9", httpBase: "http://localhost:9999" },
    },
    { source: "installer pairing guidance", argv: ["pair", "--json"], options: { json: true } },
    {
      source: "claim diagnostics",
      argv: ["claim-status", "--home", "/test/fde"],
      options: { home: "/test/fde" },
    },
    {
      source: "claim reset",
      argv: ["reset-claim", "--home", "/test/fde"],
      options: { home: "/test/fde" },
    },
    {
      source: "password guidance",
      argv: ["set-password", "--home", "/test/fde"],
      options: { home: "/test/fde" },
    },
    {
      source: "LAN access guidance",
      argv: ["trust-lan", "off", "--home", "/test/fde"],
      options: { home: "/test/fde" },
    },
    { source: "restart guidance", argv: ["restart", "--no-relay"], options: { relay: false } },
    {
      source: "config reload",
      argv: ["reload", "--host", "host-id", "--json"],
      options: { host: "host-id", json: true },
    },
    {
      source: "service installation",
      argv: ["install-service", "--home", "/test/fde"],
      options: { home: "/test/fde" },
    },
    {
      source: "service removal",
      argv: ["uninstall-service", "--home", "/test/fde"],
      options: { home: "/test/fde" },
    },
  ])("accepts $source", async ({ argv, options }) => {
    const cli = createCli().exitOverride();
    const daemon = cli.commands.find((command) => command.name() === "daemon");
    const command = daemon?.commands.find((candidate) => candidate.name() === argv[0]);
    expect(command).toBeDefined();
    if (!command) throw new Error(`Missing legacy daemon ${argv[0]}`);
    const invoked = vi.fn();
    command.action(() => {
      invoked(command.optsWithGlobals(), command.args);
    });
    await cli.parseAsync(["--json", "daemon", ...argv], { from: "user" });
    expect(invoked).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ...options, json: true }),
      argv[0] === "trust-lan" ? ["off"] : [],
    );
  });

  it("keeps canonical commands independent from their legacy instances", () => {
    const cli = createCli();
    const daemon = cli.commands.find((command) => command.name() === "daemon");
    const auth = cli.commands.find((command) => command.name() === "auth");
    for (const legacy of daemon?.commands ?? []) {
      const name = legacy.name() === "self-update" ? "update" : legacy.name();
      const canonical: Command | undefined = [...cli.commands, ...(auth?.commands ?? [])].find(
        (command) => command.name() === name,
      );
      expect(canonical, name).toBeDefined();
      expect(legacy).not.toBe(canonical);
      expect(legacy.parent).toBe(daemon);
    }
  });
});
