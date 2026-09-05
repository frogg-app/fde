import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NOTEBOOK_MAX_NOTES,
  NOTEBOOK_PROMPT_BYTE_CAP,
  serializeNotebookForPrompt,
} from "./notebook.js";
import { CompanionNotebookStore, companionNotebookPath } from "./store.js";

describe("CompanionNotebookStore", () => {
  let home: string;
  let filePath: string;
  let clock: number;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "companion-notebook-"));
    filePath = companionNotebookPath(home);
    clock = Date.parse("2025-01-01T00:00:00.000Z");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  function createStore(): CompanionNotebookStore {
    return new CompanionNotebookStore({
      filePath,
      now: () => new Date((clock += 1000)),
    });
  }

  it("starts empty when no notebook file exists", async () => {
    await expect(createStore().get()).resolves.toEqual({ notes: [] });
  });

  it("round-trips notes through disk into a fresh store", async () => {
    const store = createStore();
    await store.note({
      id: "release",
      kind: "topic",
      text: "cutting 0.1.21",
      status: "open",
      agentId: null,
    });
    await store.note({
      id: "flaky-test",
      kind: "task",
      text: "fix the flaky push test",
      status: "open",
      agentId: "agent-7",
    });

    await expect(createStore().get()).resolves.toEqual({
      notes: [
        {
          id: "flaky-test",
          kind: "task",
          text: "fix the flaky push test",
          status: "open",
          agentId: "agent-7",
          updatedAt: "2025-01-01T00:00:02.000Z",
        },
        {
          id: "release",
          kind: "topic",
          text: "cutting 0.1.21",
          status: "open",
          agentId: null,
          updatedAt: "2025-01-01T00:00:01.000Z",
        },
      ],
    });
  });

  it("upserts by id instead of appending a duplicate", async () => {
    const store = createStore();
    await store.note({
      id: "flaky-test",
      kind: "task",
      text: "fix the flaky push test",
      status: "open",
      agentId: "agent-7",
    });
    const updated = await store.note({
      id: "flaky-test",
      kind: "task",
      text: "fix the flaky push test",
      status: "done",
      agentId: "agent-7",
    });

    expect(updated.notes).toEqual([
      {
        id: "flaky-test",
        kind: "task",
        text: "fix the flaky push test",
        status: "done",
        agentId: "agent-7",
        updatedAt: "2025-01-01T00:00:02.000Z",
      },
    ]);
  });

  it("serialises concurrent writes without losing an update", async () => {
    const store = createStore();
    await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        store.note({
          id: `note-${index}`,
          kind: "task",
          text: `task ${index}`,
          status: "open",
          agentId: null,
        }),
      ),
    );

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.notes.map((note: { id: string }) => note.id)).toEqual([
      "note-4",
      "note-3",
      "note-2",
      "note-1",
      "note-0",
    ]);
  });

  it("drops the oldest notes past the retention ceiling", async () => {
    const store = createStore();
    for (let index = 0; index < NOTEBOOK_MAX_NOTES + 3; index += 1) {
      await store.note({
        id: `note-${index}`,
        kind: "task",
        text: `task ${index}`,
        status: "open",
        agentId: null,
      });
    }

    const notebook = await store.get();
    expect(notebook.notes).toHaveLength(NOTEBOOK_MAX_NOTES);
    expect(notebook.notes[0].id).toBe(`note-${NOTEBOOK_MAX_NOTES + 2}`);
    expect(notebook.notes[NOTEBOOK_MAX_NOTES - 1].id).toBe("note-3");
  });

  it("keeps valid notes and drops malformed ones when loading", async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        notes: [
          { id: "good", kind: "topic", text: "ok", status: "open", agentId: null, updatedAt: "x" },
          { id: "bad", kind: "note", text: "", status: "maybe" },
          "not an object",
        ],
      }),
      "utf8",
    );

    await expect(createStore().get()).resolves.toEqual({
      notes: [
        { id: "good", kind: "topic", text: "ok", status: "open", agentId: null, updatedAt: "x" },
      ],
    });
  });

  it("treats an unparseable notebook file as empty", async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{ this is not json", "utf8");

    await expect(createStore().get()).resolves.toEqual({ notes: [] });
  });

  it("caps the prompt rendering at the byte budget, dropping oldest notes", async () => {
    const store = createStore();
    const line = "x".repeat(200);
    for (let index = 0; index < NOTEBOOK_MAX_NOTES; index += 1) {
      await store.note({
        id: `note-${index}`,
        kind: "task",
        text: `${index} ${line}`,
        status: "open",
        agentId: null,
      });
    }

    const text = await store.promptText();
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(NOTEBOOK_PROMPT_BYTE_CAP);
    expect(text.split("\n")).toHaveLength(9);
    expect(text.startsWith(`- task (open): ${NOTEBOOK_MAX_NOTES - 1} ${line}`)).toBe(true);
    expect(text).not.toContain("- task (open): 0 ");
  });

  it("renders topics and tasks with their agent binding", () => {
    const text = serializeNotebookForPrompt({
      notes: [
        {
          id: "a",
          kind: "topic",
          text: "the release",
          status: "open",
          agentId: null,
          updatedAt: "x",
        },
        {
          id: "b",
          kind: "task",
          text: "fix the build",
          status: "done",
          agentId: "agent-2",
          updatedAt: "x",
        },
      ],
    });

    expect(text).toBe("- topic (open): the release\n- task (done): fix the build [agent agent-2]");
  });
});
