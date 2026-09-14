import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection } from "./sidebar-projection";
import {
  resolveEffectiveSidebarSortMode,
  sidebarSortNeedsWorkspaceEntries,
  sidebarWorkspaceRecency,
  sortSidebarProjects,
  sortSidebarWorkspaces,
  type SidebarSortOptions,
} from "./sidebar-sort";

function ws(
  id: string,
  options: {
    name?: string;
    project?: string;
    status?: SidebarWorkspaceEntry["statusBucket"];
    at?: string | null;
    activityAt?: string | null;
    createdAt?: string;
    projectCreatedAt?: string;
  } = {},
): SidebarWorkspaceEntry {
  return {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey: options.project ?? "p",
    projectName: options.project ?? "p",
    projectKind: "git",
    workspaceKind: "worktree",
    name: options.name ?? id,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket: options.status ?? "done",
    statusEnteredAt: options.at ? new Date(options.at) : null,
    activityAt: options.activityAt ?? null,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.projectCreatedAt ? { projectCreatedAt: options.projectCreatedAt } : {}),
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels: [],
  };
}

function project(viewKey: string, workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [],
    workspaces,
  };
}

function byKey(entries: SidebarWorkspaceEntry[]): Map<string, SidebarWorkspaceEntry> {
  return new Map(entries.map((entry) => [entry.workspaceKey, entry]));
}

const names = (items: readonly { name: string }[]) => items.map((item) => item.name);
const recent: SidebarSortOptions = { mode: "recent", reversed: false };

describe("sidebarWorkspaceRecency", () => {
  it("takes the later of status entry and daemon activity", () => {
    const entry = ws("a", { at: "2026-01-01T00:00:00Z", activityAt: "2026-02-01T00:00:00Z" });
    expect(sidebarWorkspaceRecency(entry)).toBe(Date.parse("2026-02-01T00:00:00Z"));
    expect(sidebarWorkspaceRecency(ws("b"))).toBeNull();
    expect(sidebarWorkspaceRecency(ws("c", { activityAt: "garbage" }))).toBeNull();
  });
});

describe("sortSidebarWorkspaces", () => {
  const entries = [
    ws("old", { at: "2026-01-01T00:00:00Z" }),
    ws("none"),
    ws("new", { at: "2026-03-01T00:00:00Z", status: "needs_input" }),
    ws("mid", { activityAt: "2026-02-01T00:00:00Z", status: "running" }),
  ];
  const map = byKey(entries);

  it("orders by recent activity, newest first, undated last", () => {
    expect(names(sortSidebarWorkspaces(entries, map, recent))).toEqual([
      "new",
      "mid",
      "old",
      "none",
    ]);
  });

  it("reverses recent activity but keeps undated rows last", () => {
    expect(names(sortSidebarWorkspaces(entries, map, { mode: "recent", reversed: true }))).toEqual([
      "old",
      "mid",
      "new",
      "none",
    ]);
  });

  it("orders by name naturally and case-insensitively, and reverses", () => {
    const list = [ws("b10", { name: "b10" }), ws("B2", { name: "B2" }), ws("a", { name: "a" })];
    expect(
      names(sortSidebarWorkspaces(list, byKey(list), { mode: "name", reversed: false })),
    ).toEqual(["a", "B2", "b10"]);
    expect(
      names(sortSidebarWorkspaces(list, byKey(list), { mode: "name", reversed: true })),
    ).toEqual(["b10", "B2", "a"]);
  });

  it("puts needs-attention first in status mode, newest within a status", () => {
    const list = [...entries, ws("ask-old", { status: "needs_input", at: "2025-12-01T00:00:00Z" })];
    expect(
      names(sortSidebarWorkspaces(list, byKey(list), { mode: "status", reversed: false })),
    ).toEqual(["new", "ask-old", "mid", "old", "none"]);
  });

  it("sinks workspaces without a hydrated entry in status mode in both directions", () => {
    const placement = { ...ws("unhydrated") };
    const list = [placement, ...entries];
    const partial = byKey(entries);
    const forward = sortSidebarWorkspaces(list, partial, { mode: "status", reversed: false });
    const backward = sortSidebarWorkspaces(list, partial, { mode: "status", reversed: true });
    expect(forward.at(-1)?.name).toBe("unhydrated");
    expect(backward.at(-1)?.name).toBe("unhydrated");
  });

  it("breaks ties by name then key so equal rows never swap", () => {
    const at = "2026-01-01T00:00:00Z";
    const list = [ws("z2", { name: "same", at }), ws("z1", { name: "same", at }), ws("a", { at })];
    const once = sortSidebarWorkspaces(list, byKey(list), recent);
    const again = sortSidebarWorkspaces(list.toReversed(), byKey(list), recent);
    expect(once.map((w) => w.workspaceKey)).toEqual(["srv:a", "srv:z1", "srv:z2"]);
    expect(again.map((w) => w.workspaceKey)).toEqual(once.map((w) => w.workspaceKey));
  });

  it("returns the input reference for manual mode or an unchanged order", () => {
    expect(sortSidebarWorkspaces(entries, map, { mode: "manual", reversed: true })).toBe(entries);
    const sorted = sortSidebarWorkspaces(entries, map, recent);
    expect(sortSidebarWorkspaces(sorted, map, recent)).toBe(sorted);
  });
});

describe("sortSidebarProjects", () => {
  const entries = [
    ws("a1", { project: "alpha", at: "2026-01-01T00:00:00Z" }),
    ws("a2", { project: "alpha", at: "2026-01-05T00:00:00Z", status: "failed" }),
    ws("b1", { project: "beta", at: "2026-02-01T00:00:00Z", status: "running" }),
  ];
  const map = byKey(entries);
  const projects = [
    project("empty", []),
    project("alpha", [entries[0]!, entries[1]!]),
    project("beta", [entries[2]!]),
  ];
  const keys = (items: readonly SidebarProjectEntry[]) => items.map((p) => p.viewKey);

  it("ranks projects by their most recent workspace and sorts inside each", () => {
    const sorted = sortSidebarProjects(projects, map, recent);
    expect(keys(sorted)).toEqual(["beta", "alpha", "empty"]);
    expect(names(sorted[1]!.workspaces)).toEqual(["a2", "a1"]);
  });

  it("ranks projects by their most urgent workspace in status mode", () => {
    const sorted = sortSidebarProjects(projects, map, { mode: "status", reversed: false });
    expect(keys(sorted)).toEqual(["alpha", "beta", "empty"]);
  });

  it("ranks projects by name", () => {
    const sorted = sortSidebarProjects(projects, map, { mode: "name", reversed: true });
    expect(keys(sorted)).toEqual(["empty", "beta", "alpha"]);
  });

  it("keeps project references whose workspace order is unchanged", () => {
    const sorted = sortSidebarProjects(projects, map, recent);
    expect(sorted.find((p) => p.viewKey === "beta")).toBe(projects[2]);
    expect(sortSidebarProjects(projects, map, { mode: "manual", reversed: false })).toBe(projects);
  });
});

describe("sort in the sidebar projection", () => {
  const entries = [
    ws("x-old", { project: "x", at: "2026-01-01T00:00:00Z", status: "running" }),
    ws("x-new", { project: "x", at: "2026-03-01T00:00:00Z", status: "running" }),
    ws("y", { project: "y", at: "2026-02-01T00:00:00Z", status: "running" }),
  ];
  const input = (groupMode: "project" | "status", sort?: SidebarSortOptions) => ({
    projects: [project("x", [entries[0]!, entries[1]!]), project("y", [entries[2]!])],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: byKey(entries),
    projectNamesByViewKey: new Map([
      ["x", "x"],
      ["y", "y"],
    ]),
    groupMode,
    sort,
    pinnedCollapsed: false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
  });

  it("sorts projects and their rows in project mode", () => {
    const projection = buildSidebarProjection(input("project", { mode: "name", reversed: true }));
    expect(projection.pinnedGroups.unpinnedProjects.map((p) => p.viewKey)).toEqual(["y", "x"]);
    expect(names(projection.pinnedGroups.unpinnedProjects[1]!.workspaces)).toEqual([
      "x-old",
      "x-new",
    ]);
  });

  it("keeps the stored order when no sort is given", () => {
    const projection = buildSidebarProjection(input("project"));
    expect(projection.pinnedGroups.unpinnedProjects.map((p) => p.viewKey)).toEqual(["x", "y"]);
  });

  it("sorts rows within each status group", () => {
    const projection = buildSidebarProjection(input("status", { mode: "name", reversed: false }));
    expect(projection.workspaceGroups.map((g) => g.key)).toEqual(["running"]);
    expect(names(projection.workspaceGroups[0]!.rows)).toEqual(["x-new", "x-old", "y"]);
  });

  it("only hydrates entries for sorts that need them", () => {
    expect(sidebarSortNeedsWorkspaceEntries("recent")).toBe(true);
    expect(sidebarSortNeedsWorkspaceEntries("status")).toBe(true);
    expect(sidebarSortNeedsWorkspaceEntries("created")).toBe(true);
    expect(sidebarSortNeedsWorkspaceEntries("name")).toBe(false);
    expect(sidebarSortNeedsWorkspaceEntries("manual")).toBe(false);
  });
});

describe("date created sort", () => {
  const created: SidebarSortOptions = { mode: "created", reversed: false };
  const entries = [
    ws("first", {
      project: "old",
      createdAt: "2026-01-01T00:00:00Z",
      activityAt: "2026-09-01T00:00:00Z",
    }),
    ws("second", { project: "old", createdAt: "2026-02-01T00:00:00Z" }),
    ws("undated", { project: "old" }),
    ws("third", {
      project: "new",
      createdAt: "2026-03-01T00:00:00Z",
      projectCreatedAt: "2025-12-01T00:00:00Z",
    }),
    ws("fourth", { project: "fresh", createdAt: "2026-04-01T00:00:00Z" }),
  ];
  const map = byKey(entries);

  it("orders workspaces newest created first, ignores activity, and sinks undated rows", () => {
    const rows = [entries[0]!, entries[1]!, entries[2]!];
    expect(names(sortSidebarWorkspaces(rows, map, created))).toEqual([
      "second",
      "first",
      "undated",
    ]);
    expect(names(sortSidebarWorkspaces(rows, map, { mode: "created", reversed: true }))).toEqual([
      "first",
      "second",
      "undated",
    ]);
  });

  it("ranks a project by its own creation time, else its earliest workspace", () => {
    const projects = [
      project("old", [entries[0]!, entries[1]!, entries[2]!]),
      project("new", [entries[3]!]),
      project("fresh", [entries[4]!]),
      project("empty", []),
    ];
    // fresh: earliest workspace 2026-04; old: earliest workspace 2026-01; new: project 2025-12.
    expect(sortSidebarProjects(projects, map, created).map((p) => p.viewKey)).toEqual([
      "fresh",
      "old",
      "new",
      "empty",
    ]);
  });

  it("falls back to recent activity when a host cannot send creation times", () => {
    expect(resolveEffectiveSidebarSortMode("created", false)).toBe("recent");
    expect(resolveEffectiveSidebarSortMode("created", true)).toBe("created");
    expect(resolveEffectiveSidebarSortMode("name", false)).toBe("name");
  });
});

describe("grouping by project with recent activity", () => {
  // The main complaint: project groups and the rows inside them must both follow activity, not
  // the stored drag order or names.
  const entries = [
    ws("a-stale", { project: "a", activityAt: "2026-01-01T00:00:00Z" }),
    ws("a-busy", { project: "a", activityAt: "2026-05-01T00:00:00Z" }),
    ws("b-mid", { project: "b", at: "2026-03-01T00:00:00Z" }),
    ws("c-latest", { project: "c", activityAt: "2026-06-01T00:00:00Z" }),
    ws("c-old", { project: "c", at: "2026-02-01T00:00:00Z" }),
  ];

  it("orders project groups and their workspaces by recent activity", () => {
    const projection = buildSidebarProjection({
      // The stored order deliberately disagrees with activity.
      projects: [
        project("a", [entries[0]!, entries[1]!]),
        project("b", [entries[2]!]),
        project("c", [entries[4]!, entries[3]!]),
      ],
      pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      pinnedWorkspaceOrder: [],
      workspaceEntriesByKey: byKey(entries),
      projectNamesByViewKey: new Map([
        ["a", "a"],
        ["b", "b"],
        ["c", "c"],
      ]),
      groupMode: "project",
      sort: recent,
      pinnedCollapsed: false,
      collapsedProjectKeys: new Set<string>(),
      collapsedWorkspaceGroupKeys: new Set<string>(),
    });
    const groups = projection.pinnedGroups.unpinnedProjects;
    expect(groups.map((p) => p.viewKey)).toEqual(["c", "a", "b"]);
    expect(groups.map((p) => names(p.workspaces))).toEqual([
      ["c-latest", "c-old"],
      ["a-busy", "a-stale"],
      ["b-mid"],
    ]);
  });
});
