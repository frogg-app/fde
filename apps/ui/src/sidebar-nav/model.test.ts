import { describe, expect, it } from "vitest";
import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import {
  builtinSidebarNavShortcutAction,
  moveSidebarNavItem,
  pluginSidebarNavKey,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
  type SidebarNavPreference,
} from "./model";

function group(pluginId: string, contributionId: string): PluginSidebarGroup {
  return {
    key: `${pluginId}/sidebar/${contributionId}`,
    pluginId,
    contributionId,
    title: contributionId,
    icon: "puzzle",
    targets: [],
  };
}

const kanban = group("kanban", "board");
const notes = group("notes", "inbox");
const kanbanKey = pluginSidebarNavKey(kanban);
const notesKey = pluginSidebarNavKey(notes);

function summarize(items: readonly SidebarNavItem[]): SidebarNavPreference[] {
  return items.map(({ key, visible }) => ({ key, visible }));
}

describe("resolveSidebarNavItems", () => {
  it.each([
    ["new-workspace", "history", "search"],
    ["new-workspace", "companion", "history", "search"],
  ])("migrates a persisted default order %j", (...keys) => {
    const preferences = keys.map((key) => ({ key, visible: key !== "companion" }));
    const items = resolveSidebarNavItems({ pluginGroups: [], preferences });
    expect(items.map(({ key }) => key)).toEqual(["home", "search", "history", "companion"]);
    if (keys.includes("companion")) {
      expect(items.find(({ key }) => key === "companion")?.visible).toBe(false);
    }
  });

  it("introduces Home first without inheriting retired workspace visibility", () => {
    const preferences = [
      { key: "new-workspace", visible: false },
      { key: "search", visible: true },
      { key: "history", visible: false },
      { key: "companion", visible: false },
    ];

    expect(summarize(resolveSidebarNavItems({ pluginGroups: [], preferences }))).toEqual([
      { key: "home", visible: true },
      { key: "search", visible: true },
      { key: "history", visible: false },
      { key: "companion", visible: false },
    ]);
  });

  it("yields builtins then plugins, all visible, when nothing is stored", () => {
    const items = resolveSidebarNavItems({ pluginGroups: [kanban, notes], preferences: [] });

    expect(summarize(items)).toEqual([
      { key: "home", visible: true },
      { key: "search", visible: true },
      { key: "history", visible: true },
      { key: "companion", visible: true },
      { key: kanbanKey, visible: true },
      { key: notesKey, visible: true },
    ]);
    expect(items[4]).toEqual({ kind: "plugin", key: kanbanKey, group: kanban, visible: true });
    expect(items[0]).toEqual({
      kind: "builtin",
      key: "home",
      id: "home",
      visible: true,
    });
  });

  it("keeps the stored order and appends newly available items as visible", () => {
    const items = resolveSidebarNavItems({
      pluginGroups: [notes, kanban],
      preferences: [
        { key: kanbanKey, visible: false },
        { key: "search", visible: true },
        { key: "home", visible: false },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: kanbanKey, visible: false },
      { key: "search", visible: true },
      { key: "home", visible: false },
      { key: "history", visible: true },
      { key: "companion", visible: true },
      { key: notesKey, visible: true },
    ]);
  });

  it("skips keys that are unknown or not currently available", () => {
    const items = resolveSidebarNavItems({
      pluginGroups: [],
      preferences: [
        { key: notesKey, visible: false },
        { key: "bogus", visible: true },
        { key: "history", visible: true },
      ],
    });

    expect(items.map((item) => item.key)).toEqual(["home", "history", "search", "companion"]);
  });

  it("lets the first of duplicate keys win", () => {
    const items = resolveSidebarNavItems({
      pluginGroups: [],
      preferences: [
        { key: "history", visible: false },
        { key: "history", visible: true },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: "home", visible: true },
      { key: "history", visible: false },
      { key: "search", visible: true },
      { key: "companion", visible: true },
    ]);
  });
});

describe("setSidebarNavItemVisible", () => {
  it("toggles one item and writes the full resolved order", () => {
    const items = resolveSidebarNavItems({ pluginGroups: [kanban], preferences: [] });

    const next = setSidebarNavItemVisible({ items, key: "search", visible: false, previous: [] });

    expect(next).toEqual([
      { key: "home", visible: true },
      { key: "search", visible: false },
      { key: "history", visible: true },
      { key: "companion", visible: true },
      { key: kanbanKey, visible: true },
    ]);
  });

  it("carries preferences for unavailable plugins through an unrelated edit", () => {
    const previous: SidebarNavPreference[] = [
      { key: notesKey, visible: false },
      { key: "history", visible: true },
    ];
    const items = resolveSidebarNavItems({ pluginGroups: [], preferences: previous });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: notesKey, visible: false },
      { key: "home", visible: true },
      { key: "history", visible: false },
      { key: "search", visible: true },
      { key: "companion", visible: true },
    ]);
  });

  it("keeps an unavailable plugin in its configured position", () => {
    const previous: SidebarNavPreference[] = [
      { key: "home", visible: true },
      { key: notesKey, visible: false },
      { key: "history", visible: true },
      { key: "search", visible: true },
    ];
    const items = resolveSidebarNavItems({ pluginGroups: [], preferences: previous });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: "home", visible: true },
      { key: notesKey, visible: false },
      { key: "history", visible: false },
      { key: "search", visible: true },
      { key: "companion", visible: true },
    ]);
    expect(summarize(resolveSidebarNavItems({ pluginGroups: [notes], preferences: next }))).toEqual(
      next,
    );
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const items = resolveSidebarNavItems({ pluginGroups: [], preferences: [] });

    const next = setSidebarNavItemVisible({ items, key: "bogus", visible: false, previous: [] });

    expect(next).toEqual(summarize(items));
  });
});

describe("moveSidebarNavItem", () => {
  const items = resolveSidebarNavItems({ pluginGroups: [kanban], preferences: [] });

  it("moves an item up", () => {
    const next = moveSidebarNavItem({ items, key: "search", direction: "up", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "search",
      "home",
      "history",
      "companion",
      kanbanKey,
    ]);
  });

  it("moves an item down", () => {
    const next = moveSidebarNavItem({ items, key: "search", direction: "down", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "home",
      "history",
      "search",
      "companion",
      kanbanKey,
    ]);
  });

  it("leaves the order alone at the boundaries", () => {
    const first = moveSidebarNavItem({
      items,
      key: "home",
      direction: "up",
      previous: [],
    });
    const last = moveSidebarNavItem({ items, key: kanbanKey, direction: "down", previous: [] });

    expect(first).toEqual(summarize(items));
    expect(last).toEqual(summarize(items));
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const next = moveSidebarNavItem({ items, key: "bogus", direction: "down", previous: [] });

    expect(next).toEqual(summarize(items));
  });

  it("drops duplicate carried-over keys", () => {
    const previous: SidebarNavPreference[] = [
      { key: notesKey, visible: false },
      { key: notesKey, visible: true },
    ];

    const next = moveSidebarNavItem({ items, key: "history", direction: "up", previous });

    expect(next.filter((preference) => preference.key === notesKey)).toEqual([
      { key: notesKey, visible: false },
    ]);
  });
});

describe("builtinSidebarNavShortcutAction", () => {
  it("maps only the builtins that have a keyboard shortcut", () => {
    expect(builtinSidebarNavShortcutAction("home")).toBeNull();
    expect(builtinSidebarNavShortcutAction("search")).toBe("toggle-command-center");
    expect(builtinSidebarNavShortcutAction("companion")).toBe("toggle-companion");
    expect(builtinSidebarNavShortcutAction("history")).toBeNull();
  });
});
