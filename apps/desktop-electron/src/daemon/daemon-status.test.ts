import { it, expect } from "vitest";
import { statusFromDaemonProbe } from "./daemon-status.js";

it("does not adopt another home's reachable daemon when local PID state is stopped", () => {
  const status = statusFromDaemonProbe(
    {
      localDaemon: "stopped",
      connectedDaemon: "reachable",
      pid: null,
      desktopManaged: false,
      daemonVersion: "0.4.2",
      listen: "127.0.0.1:9999",
      serverId: "new-home",
      hostname: "other-daemon",
    },
    "/isolated-home",
  );
  expect(status).toMatchObject({
    status: "stopped",
    pid: null,
    desktopManaged: false,
    version: null,
    hostname: null,
    home: "/isolated-home",
  });
});
it("requires a valid local PID and preserves unresponsive local processes", () => {
  expect(statusFromDaemonProbe({ localDaemon: "running", pid: null }, "/home").status).toBe(
    "stopped",
  );
  expect(
    statusFromDaemonProbe({ localDaemon: "running", pid: 123, desktopManaged: true }, "/home"),
  ).toMatchObject({ status: "running", pid: 123, desktopManaged: true });
  expect(
    statusFromDaemonProbe(
      { localDaemon: "unresponsive", pid: 123, connectedDaemon: "reachable" },
      "/home",
    ),
  ).toMatchObject({ status: "errored", pid: 123 });
});
