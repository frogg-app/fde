import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { inferLegacySidebarSortMode } from "./sidebar-sort-migration";

function placement(id: string, projectKey: string): SidebarWorkspacePlacement {
  return {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey: projectKey,
    projectName: projectKey,
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
}

function entry(
  workspace: SidebarWorkspacePlacement,
  createdAt?: string,
  projectCreatedAt?: string,
): SidebarWorkspaceEntry {
  return {
    ...workspace,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    ...(createdAt ? { createdAt } : {}),
    ...(projectCreatedAt ? { projectCreatedAt } : {}),
  };
}

function project(viewKey: string, ids: string[]): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "git",
    iconWorkingDir: "",
    hosts: [],
    workspaces: ids.map((id) => placement(id, viewKey)),
  };
}

// Structural (name) order, as the sidebar builds it.
const alpha = project("alpha", ["a1", "a2", "a3"]);
const beta = project("beta", ["b1"]);
const gamma = project("gamma", ["g1"]);
const projects = [alpha, beta, gamma];

function entries(times: Record<string, [string?, string?]>) {
  const map = new Map<string, SidebarWorkspaceEntry>();
  for (const p of projects) {
    for (const w of p.workspaces) {
      const [createdAt, projectCreatedAt] = times[w.workspaceId] ?? [];
      map.set(w.workspaceKey, entry(w, createdAt, projectCreatedAt));
    }
  }
  return map;
}

describe("inferLegacySidebarSortMode", () => {
  it("defaults to recent activity when nothing was stored", () => {
    expect(
      inferLegacySidebarSortMode({
        projects,
        projectOrder: [],
        workspaceOrderByProject: {},
        entriesByKey: entries({}),
      }),
    ).toBe("recent");
  });

  it("treats orders the sidebar wrote by itself as not customized", () => {
    expect(
      inferLegacySidebarSortMode({
        projects,
        // Initial batch in name order, then a project appended later.
        projectOrder: ["alpha", "gamma", "beta"],
        // A workspace prepended after the initial name-ordered batch.
        workspaceOrderByProject: { alpha: ["srv:a3", "srv:a1", "srv:a2"] },
        entriesByKey: entries({
          a1: ["2026-01-01T00:00:00Z", "2025-01-01T00:00:00Z"],
          a2: ["2026-01-02T00:00:00Z"],
          a3: ["2026-03-01T00:00:00Z"],
          g1: ["2026-01-01T00:00:00Z", "2025-02-01T00:00:00Z"],
          b1: ["2026-01-01T00:00:00Z", "2025-06-01T00:00:00Z"],
        }),
      }),
    ).toBe("recent");
  });

  it("keeps manual when projects were dragged out of any automatic order", () => {
    expect(
      inferLegacySidebarSortMode({
        projects,
        // gamma above alpha, though alpha is older and sorts first by name.
        projectOrder: ["gamma", "alpha", "beta"],
        workspaceOrderByProject: {},
        entriesByKey: entries({
          a1: [undefined, "2025-01-01T00:00:00Z"],
          b1: [undefined, "2025-06-01T00:00:00Z"],
          g1: [undefined, "2025-02-01T00:00:00Z"],
        }),
      }),
    ).toBe("manual");
  });

  it("keeps manual when workspaces inside a project were dragged", () => {
    expect(
      inferLegacySidebarSortMode({
        projects,
        projectOrder: ["alpha", "beta", "gamma"],
        // a1 older than a2 but placed above it, ahead of a name-ordered run.
        workspaceOrderByProject: { alpha: ["srv:a1", "srv:a3", "srv:a2"] },
        entriesByKey: entries({
          a1: ["2026-01-01T00:00:00Z"],
          a2: ["2026-02-01T00:00:00Z"],
          a3: ["2026-03-01T00:00:00Z"],
        }),
      }),
    ).toBe("manual");
  });

  it("leans to recent activity when creation times are unknown", () => {
    expect(
      inferLegacySidebarSortMode({
        projects,
        projectOrder: ["alpha", "gamma", "beta"],
        workspaceOrderByProject: { alpha: ["srv:a3", "srv:a1", "srv:a2"] },
        entriesByKey: entries({}),
      }),
    ).toBe("recent");
  });
});
