import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import type { AgentManager } from "./agent-manager.js";
import {
  collectMidTurnAgentIds,
  INTERRUPTED_TURN_CONTINUATION_PROMPT,
  resumeInterruptedAgents,
} from "./interrupted-turns.js";

const NOW = Date.parse("2026-09-13T12:00:00.000Z");

function record(id: string, overrides: Partial<StoredAgentRecord> = {}): StoredAgentRecord {
  return {
    id,
    provider: "claude",
    cwd: "/tmp/project",
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:00:00.000Z",
    labels: {},
    lastStatus: "closed",
    config: null,
    persistence: { provider: "claude", sessionId: `session-${id}` },
    ...overrides,
  } as StoredAgentRecord;
}

describe("collectMidTurnAgentIds", () => {
  test("selects non-internal running agents with a session id", () => {
    const base = { persistence: { provider: "claude", sessionId: "s" }, internal: false };
    const ids = collectMidTurnAgentIds([
      { ...base, id: "running", lifecycle: "running", activeForegroundTurnId: "t" },
      { ...base, id: "idle", lifecycle: "idle", activeForegroundTurnId: null },
      {
        ...base,
        id: "internal",
        internal: true,
        lifecycle: "running",
        activeForegroundTurnId: "t",
      },
      {
        ...base,
        id: "nosession",
        persistence: null,
        lifecycle: "running",
        activeForegroundTurnId: "t",
      },
    ] as never);
    expect(ids).toEqual(["running"]);
  });
});

describe("interrupted turn persistence and resume", () => {
  let dir: string;
  let storage: AgentStorage;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "interrupted-turns-"));
    storage = new AgentStorage(dir, createTestLogger());
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("marks records and survives a reload", async () => {
    await storage.upsert(record("a"));
    await storage.markInterruptedTurn(["a", "missing"], {
      at: "2026-09-13T11:59:00.000Z",
      reason: "daemon_restart",
    });
    await storage.flush();
    const reloaded = new AgentStorage(dir, createTestLogger());
    expect((await reloaded.get("a"))?.interruptedTurn).toEqual({
      at: "2026-09-13T11:59:00.000Z",
      reason: "daemon_restart",
    });
  });

  test("resumes only eligible records and clears every flag first", async () => {
    const interruptedTurn = { at: "2026-09-13T11:59:00.000Z", reason: "daemon_restart" };
    await storage.upsert(record("fresh", { interruptedTurn }));
    await storage.upsert(
      record("stale", { interruptedTurn: { ...interruptedTurn, at: "2026-09-13T10:00:00.000Z" } }),
    );
    await storage.upsert(
      record("archived", { interruptedTurn, archivedAt: "2026-09-13T11:59:30.000Z" }),
    );
    await storage.upsert(record("internal", { interruptedTurn, internal: true }));
    await storage.upsert(record("failing", { interruptedTurn }));
    await storage.upsert(record("plain"));

    const sendPrompt = vi.fn(async (params: { agentId: string; prompt: unknown }) => {
      expect((await storage.get(params.agentId))?.interruptedTurn).toBeNull();
      if (params.agentId === "failing") {
        throw new Error("boom");
      }
      return { disposition: "turn_started" as const };
    });

    const resumed = await resumeInterruptedAgents({
      agentManager: {} as AgentManager,
      agentStorage: storage,
      logger: createTestLogger(),
      now: () => NOW,
      sendPrompt: sendPrompt as never,
    });

    expect(resumed).toEqual(["fresh"]);
    expect(sendPrompt.mock.calls.map(([p]) => p.agentId).sort()).toEqual(["failing", "fresh"]);
    expect(sendPrompt.mock.calls[0]?.[0].prompt).toBe(INTERRUPTED_TURN_CONTINUATION_PROMPT);
    for (const agent of await storage.list()) {
      expect(agent.interruptedTurn ?? null).toBeNull();
    }
  });
});
