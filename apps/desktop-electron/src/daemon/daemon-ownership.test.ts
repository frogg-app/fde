import { it, expect } from "vitest";
import { DaemonOwnership } from "./daemon-ownership.js";

it("only stops the supervisor this app actually spawned", () => {
  const owner = new DaemonOwnership();
  const status = { pid: 123, desktopManaged: true };
  expect(owner.owns(status)).toBe(false); // Existing Tauri/another Electron daemon.
  owner.recordStarted(456, status); // Another daemon won the startup race.
  expect(owner.owns(status)).toBe(false);
  owner.recordStarted(123, status);
  expect(owner.owns(status)).toBe(true);
  expect(owner.owns({ ...status, desktopManaged: false })).toBe(false);
  expect(owner.owns({ ...status, pid: 789 })).toBe(false);
  owner.release();
  expect(owner.owns(status)).toBe(false);
});

it("explains why manual stop or restart cannot control a daemon owned by another session", () => {
  const ownership = new DaemonOwnership();
  const status = { pid: 123, desktopManaged: true };
  expect(() => ownership.assertManualControl(status)).toThrow(
    "Stop it using its owning app or CLI",
  );
  ownership.recordStarted(123, status);
  expect(() => ownership.assertManualControl(status)).not.toThrow();
});
