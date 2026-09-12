import { expect, it } from "vitest";
import { sidebarConnectionMessage } from "./connection";

it("does not report saved activity as offline during startup or reconnection", () => {
  for (const status of [undefined, "idle", "connecting"] as const) {
    expect(sidebarConnectionMessage(status)).toBe("common.connectionStatus.connecting");
  }
});

it("clears the connection message after reconnecting and reports a confirmed disconnect", () => {
  expect(
    ["online", "connecting", "online", "offline", "error"].map((status) =>
      sidebarConnectionMessage(status as "online" | "connecting" | "offline" | "error"),
    ),
  ).toEqual([
    null,
    "common.connectionStatus.connecting",
    null,
    "subagents.offline",
    "subagents.offline",
  ]);
});
