import type { CompanionNotebookEntry } from "@fde/protocol/messages";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TopicsStrip } from "./topics-strip";

interface OpenedAgent {
  serverId: string;
  agentId: string;
}

interface Mounted {
  root: Root;
  container: HTMLDivElement;
  opened: OpenedAgent[];
}

const mounted: Mounted[] = [];

// Module scope, because the perf lint rejects a handler created beside the JSX.
const opened: OpenedAgent[] = [];

function recordOpen(input: OpenedAgent): void {
  opened.push(input);
}

function mountStrip(topics: readonly CompanionNotebookEntry[]): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<TopicsStrip topics={topics} onOpenAgent={recordOpen} />));

  const entry: Mounted = { root, container, opened };
  mounted.push(entry);
  return entry;
}

function row(entry: Mounted, id: string): HTMLElement {
  const element = entry.container.querySelector(`[data-testid="companion-topic-${id}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Topic row ${id} did not render`);
  }
  return element;
}

function topic(overrides: Partial<CompanionNotebookEntry> = {}): CompanionNotebookEntry {
  return {
    id: "topic-1",
    kind: "topic",
    title: "Ship the installer",
    state: "running",
    agent: { serverId: "local", agentId: "agent-1", label: "installer" },
    ...overrides,
  };
}

afterEach(() => {
  opened.length = 0;
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("TopicsStrip", () => {
  // i18n is not initialised in the browser project, so the key stands in for the
  // copy here; resources.test.ts is what guards the wording.
  it("shows the empty state when the notebook is empty", () => {
    const entry = mountStrip([]);

    const empty = entry.container.querySelector('[data-testid="companion-topics-empty"]');
    expect(empty?.textContent).toBe("companion.topics.empty");
  });

  it("renders one row per notebook entry, with its title and agent chip", () => {
    const entry = mountStrip([
      topic(),
      topic({ id: "topic-2", kind: "task", title: "Check the relay", state: "needs_input" }),
    ]);

    expect(row(entry, "topic-1").textContent).toContain("Ship the installer");
    expect(row(entry, "topic-1").textContent).toContain("installer");
    expect(row(entry, "topic-2").textContent).toContain("Check the relay");
  });

  it("gives each row the status dot colour for its state", () => {
    const entry = mountStrip([
      topic({ id: "running", state: "running" }),
      topic({ id: "needs-input", state: "needs_input" }),
      topic({ id: "failed", state: "failed" }),
    ]);

    const dotColor = (id: string) => {
      const dot = row(entry, id).firstElementChild;
      if (!(dot instanceof HTMLElement)) throw new Error(`Row ${id} rendered no status dot`);
      return getComputedStyle(dot).backgroundColor;
    };

    expect(dotColor("running")).toBe("rgb(38, 138, 224)");
    expect(dotColor("needs-input")).toBe("rgb(179, 120, 36)");
    expect(dotColor("failed")).toBe("rgb(241, 46, 47)");
  });

  it("navigates to the agent a row refers to when it is tapped", () => {
    const entry = mountStrip([topic()]);

    act(() => {
      row(entry, "topic-1").click();
    });

    expect(entry.opened).toEqual([{ serverId: "local", agentId: "agent-1" }]);
  });

  it("does not make a row without an agent pressable", () => {
    const entry = mountStrip([topic({ id: "no-agent", agent: null })]);

    act(() => {
      row(entry, "no-agent").click();
    });

    expect(entry.opened).toEqual([]);
  });
});
