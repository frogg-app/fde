import { describe, expect, it } from "vitest";
import {
  builtinSidebarNavShortcutAction,
  moveSidebarNavItem,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
  type SidebarNavPreference,
} from "./model";

// A key left in settings by the removed plugin support; it is never resolved but must survive edits.
const staleKey = "plugin:notes:inbox";

function summarize(items: readonly SidebarNavItem[]): SidebarNavPreference[] {
  return items.map(({ key, visible }) => ({ key, visible }));
}

describe("resolveSidebarNavItems", () => {
  it.each([
    ["new-workspace", "history", "search"],
    ["new-workspace", "companion", "history", "search"],
  ])("migrates a persisted default order %j", (...keys) => {
    const preferences = keys.map((key) => ({ key, visible: key !== "companion" }));
    const items = resolveSidebarNavItems({ preferences });
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

    expect(summarize(resolveSidebarNavItems({ preferences }))).toEqual([
      { key: "home", visible: true },
      { key: "search", visible: true },
      { key: "history", visible: false },
      { key: "companion", visible: false },
    ]);
  });

  it("yields builtins, all visible, when nothing is stored", () => {
    const items = resolveSidebarNavItems({ preferences: [] });

    expect(summarize(items)).toEqual([
      { key: "home", visible: true },
      { key: "search", visible: true },
      { key: "history", visible: true },
      { key: "companion", visible: true },
    ]);
    expect(items[0]).toEqual({
      kind: "builtin",
      key: "home",
      id: "home",
      visible: true,
    });
  });

  it("keeps the stored order and appends newly available items as visible", () => {
    const items = resolveSidebarNavItems({
      preferences: [
        { key: "search", visible: true },
        { key: "home", visible: false },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: "search", visible: true },
      { key: "home", visible: false },
      { key: "history", visible: true },
      { key: "companion", visible: true },
    ]);
  });

  it("skips keys that are unknown or not currently available", () => {
    const items = resolveSidebarNavItems({
      preferences: [
        { key: staleKey, visible: false },
        { key: "bogus", visible: true },
        { key: "history", visible: true },
      ],
    });

    expect(items.map((item) => item.key)).toEqual(["home", "history", "search", "companion"]);
  });

  it("lets the first of duplicate keys win", () => {
    const items = resolveSidebarNavItems({
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
    const items = resolveSidebarNavItems({ preferences: [] });

    const next = setSidebarNavItemVisible({ items, key: "search", visible: false, previous: [] });

    expect(next).toEqual([
      { key: "home", visible: true },
      { key: "search", visible: false },
      { key: "history", visible: true },
      { key: "companion", visible: true },
    ]);
  });

  it("carries preferences for unavailable keys through an unrelated edit", () => {
    const previous: SidebarNavPreference[] = [
      { key: staleKey, visible: false },
      { key: "history", visible: true },
    ];
    const items = resolveSidebarNavItems({ preferences: previous });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: staleKey, visible: false },
      { key: "home", visible: true },
      { key: "history", visible: false },
      { key: "search", visible: true },
      { key: "companion", visible: true },
    ]);
  });

  it("keeps an unavailable key in its configured position", () => {
    const previous: SidebarNavPreference[] = [
      { key: "home", visible: true },
      { key: staleKey, visible: false },
      { key: "history", visible: true },
      { key: "search", visible: true },
    ];
    const items = resolveSidebarNavItems({ preferences: previous });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: "home", visible: true },
      { key: staleKey, visible: false },
      { key: "history", visible: false },
      { key: "search", visible: true },
      { key: "companion", visible: true },
    ]);
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const items = resolveSidebarNavItems({ preferences: [] });

    const next = setSidebarNavItemVisible({ items, key: "bogus", visible: false, previous: [] });

    expect(next).toEqual(summarize(items));
  });
});

describe("moveSidebarNavItem", () => {
  const items = resolveSidebarNavItems({ preferences: [] });

  it("moves an item up", () => {
    const next = moveSidebarNavItem({ items, key: "search", direction: "up", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "search",
      "home",
      "history",
      "companion",
    ]);
  });

  it("moves an item down", () => {
    const next = moveSidebarNavItem({ items, key: "search", direction: "down", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "home",
      "history",
      "search",
      "companion",
    ]);
  });

  it("leaves the order alone at the boundaries", () => {
    const first = moveSidebarNavItem({
      items,
      key: "home",
      direction: "up",
      previous: [],
    });
    const last = moveSidebarNavItem({ items, key: "companion", direction: "down", previous: [] });

    expect(first).toEqual(summarize(items));
    expect(last).toEqual(summarize(items));
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const next = moveSidebarNavItem({ items, key: "bogus", direction: "down", previous: [] });

    expect(next).toEqual(summarize(items));
  });

  it("drops duplicate carried-over keys", () => {
    const previous: SidebarNavPreference[] = [
      { key: staleKey, visible: false },
      { key: staleKey, visible: true },
    ];

    const next = moveSidebarNavItem({ items, key: "history", direction: "up", previous });

    expect(next.filter((preference) => preference.key === staleKey)).toEqual([
      { key: staleKey, visible: false },
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
