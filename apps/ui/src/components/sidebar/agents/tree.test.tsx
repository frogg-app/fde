/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import { ProviderSubagentHistoryStatus } from "@/subagents/provider-history";
import { SidebarAgentBranch } from "./tree";
import type { SidebarAgentNode } from "./model";
import { en } from "@/i18n/resources/en";

vi.hoisted(() => {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: () => ({ startTime: 0, cancel() {} }),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

// This test mounts sidebar rows; full pane registration pulls native Markdown into jsdom.
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered() {} }));

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });
const child: SidebarAgentNode = {
  key: "host\0provider\0parent\0child",
  serverId: "host",
  workspaceId: "workspace",
  target: { kind: "provider_subagent", parentAgentId: "parent", subagentId: "child" },
  row: {
    kind: "provider",
    id: "child",
    parentAgentId: "parent",
    provider: "codex",
    title: "Worker",
    description: "Inspect the runtime",
    subtitle: "Codex worker",
    status: "running",
    requiresAttention: false,
    createdAt: new Date(),
  },
  children: [],
};
const parent: SidebarAgentNode = {
  ...child,
  key: "host\0agent\0parent",
  target: { kind: "agent", agentId: "parent" },
  row: {
    kind: "paseo",
    id: "parent",
    provider: "codex",
    title: "Build the sidebar",
    description: null,
    subtitle: null,
    status: "running",
    requiresAttention: false,
    createdAt: new Date(),
  },
  children: [child],
};
afterEach(cleanup);

describe("sidebar subagent interaction", () => {
  it("opens the child's own runtime and preserves the tree when collapsing and reopening", () => {
    const onOpen = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={parent}
          discovery={new Map()}
          offline={false}
          selectedTarget={child.target}
          onOpen={onOpen}
        />
      </I18nextProvider>,
    );
    const childButton = screen.getByRole("button", { name: "Inspect the runtime" });
    expect(childButton.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(childButton);
    expect(onOpen).toHaveBeenCalledWith(child);
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse subagents for Build the sidebar" }),
    );
    expect(screen.queryByRole("button", { name: "Inspect the runtime" })).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Expand subagents for Build the sidebar" }));
    expect(screen.getAllByRole("button", { name: "Inspect the runtime" })).toHaveLength(1);
  });

  it("reveals a newly spawned child unless the parent was explicitly collapsed", () => {
    const onOpen = vi.fn();
    const renderBranch = (node: SidebarAgentNode) => (
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={node}
          discovery={new Map()}
          offline={false}
          selectedTarget={null}
          onOpen={onOpen}
        />
      </I18nextProvider>
    );
    const view = render(renderBranch({ ...parent, children: [] }));
    expect(screen.queryByRole("button", { name: "Inspect the runtime" })).toBeNull();
    view.rerender(renderBranch(parent));
    expect(screen.getAllByRole("button", { name: "Inspect the runtime" })).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse subagents for Build the sidebar" }),
    );
    view.rerender(renderBranch({ ...parent, children: [] }));
    view.rerender(renderBranch(parent));
    expect(screen.queryByRole("button", { name: "Inspect the runtime" })).toBeNull();
  });

  it("exposes discovery failure and retries without opening another session", () => {
    const retry = vi.fn();
    const onOpen = vi.fn();
    const discovery = new Map([
      [parent.key, { pending: false, failed: true, retry, discover: vi.fn() }],
    ]);
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={parent}
          discovery={discovery}
          offline={false}
          selectedTarget={null}
          onOpen={onOpen}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Could not load subagents · Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks disconnected activity as saved and keeps the child accessible", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={parent}
          discovery={new Map()}
          offline
          selectedTarget={null}
          onOpen={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByText("Offline · showing saved activity")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Inspect the runtime" })).toHaveLength(1);
  });
});

const pendingHistory = { connected: true, pending: true, failed: false, retry: vi.fn() };
const failedHistory = { ...pendingHistory, pending: false, failed: true };
const loadedHistory = { ...pendingHistory, pending: false };

describe("provider transcript attachment feedback", () => {
  it("shows pending, failure/retry, and loaded activity without an empty-success state", () => {
    const retry = pendingHistory.retry;
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ProviderSubagentHistoryStatus history={pendingHistory} hasTimeline={false} />
      </I18nextProvider>,
    );
    expect(screen.getAllByText("Loading...")).toHaveLength(1);
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ProviderSubagentHistoryStatus history={failedHistory} hasTimeline={false} />
      </I18nextProvider>,
    );
    expect(screen.queryByText("Loading...")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Could not load activity · Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ProviderSubagentHistoryStatus history={loadedHistory} hasTimeline />
      </I18nextProvider>,
    );
    expect(view.container.textContent).toBe("");
  });
});
