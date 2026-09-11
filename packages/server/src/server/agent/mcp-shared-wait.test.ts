import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentManager, WaitForAgentResult } from "./agent-manager.js";
import { waitForAgentWithTimeout } from "./mcp-shared.js";

const finished: WaitForAgentResult = {
  status: "idle",
  permission: null,
  lastMessage: "Finished",
};

function managerWithWait(
  waitForAgentEvent: AgentManager["waitForAgentEvent"],
): Pick<AgentManager, "waitForAgentEvent" | "getAgent" | "getTimeline"> {
  return { waitForAgentEvent, getAgent: () => null, getTimeline: () => [] };
}

const waitUntilAborted: AgentManager["waitForAgentEvent"] = (_id, options) =>
  new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
      once: true,
    });
  });

describe("MCP agent wait cancellation lifetime", () => {
  afterEach(() => vi.useRealTimers());

  it("returns progress on timeout and releases the caller listener", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const manager = managerWithWait(waitUntilAborted);
    const pending = waitForAgentWithTimeout(manager, "agent", { signal: caller.signal });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({
      status: "idle",
      permission: null,
      lastMessage: expect.stringContaining("Awaiting the agent timed out"),
    });
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases caller abort listeners after repeated completed waits", async () => {
    const caller = new AbortController();
    const manager = managerWithWait(async () => finished);

    for (let index = 0; index < 100; index += 1) {
      await expect(
        waitForAgentWithTimeout(manager, "agent", { signal: caller.signal }),
      ).resolves.toEqual(finished);
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    }
  });

  it("releases the listener when the wait fails", async () => {
    const caller = new AbortController();
    const failure = new Error("Agent closed");
    const manager = managerWithWait(async () => {
      throw failure;
    });

    await expect(waitForAgentWithTimeout(manager, "agent", { signal: caller.signal })).rejects.toBe(
      failure,
    );
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("forwards cancellation while a wait is active", async () => {
    const caller = new AbortController();
    const reason = new Error("Tool canceled");
    const manager = managerWithWait(waitUntilAborted);
    const pending = waitForAgentWithTimeout(manager, "agent", { signal: caller.signal });
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(1);
    caller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("passes an already canceled caller signal into the wait", async () => {
    const caller = new AbortController();
    const reason = new Error("Tool already canceled");
    caller.abort(reason);
    const manager = managerWithWait(async (_id, options) => {
      options?.signal?.throwIfAborted();
      return finished;
    });
    await expect(waitForAgentWithTimeout(manager, "agent", { signal: caller.signal })).rejects.toBe(
      reason,
    );
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });
});
