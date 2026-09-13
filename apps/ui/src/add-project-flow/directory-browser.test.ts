import { describe, expect, it, vi } from "vitest";
import { buildDirectoryBrowserRows, directoryNavigationTarget } from "./directory-browser";
import { parentDirectory } from "./options";

vi.mock("lucide-react-native", () => ({
  ArrowUp: () => null,
  Folder: () => null,
  FolderPlus: () => null,
  RotateCw: () => null,
}));

const listing = {
  path: ".",
  absolutePath: "/home/dev",
  entries: [
    { name: "beta", kind: "directory" as const, path: "beta", size: 0, modifiedAt: "" },
    { name: "alpha", kind: "directory" as const, path: "alpha", size: 0, modifiedAt: "" },
    { name: "alpha.txt", kind: "file" as const, path: "alpha.txt", size: 0, modifiedAt: "" },
  ],
};
function input(overrides = {}) {
  return {
    directory: "~",
    query: "",
    listing,
    pending: false,
    failed: false,
    navigate: vi.fn(),
    choose: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

describe("directory browsing", () => {
  it("pins choosing and parent navigation above sorted immediate subdirectories", () => {
    const context = input();
    const rows = buildDirectoryBrowserRows(context);
    expect(rows.map(({ id, pinned }) => ({ id, pinned: pinned === true }))).toEqual([
      { id: "choose:/home/dev", pinned: true },
      { id: "parent:/home", pinned: true },
      { id: "/home/dev/alpha", pinned: false },
      { id: "/home/dev/beta", pinned: false },
    ]);
    rows[2]!.select();
    expect(context.navigate).toHaveBeenCalledWith("/home/dev/alpha");
    expect(context.choose).not.toHaveBeenCalled();
  });
  it("filters child names without filtering pinned actions", () => {
    expect(buildDirectoryBrowserRows(input({ query: "ALP" })).map((row) => row.id)).toEqual([
      "choose:/home/dev",
      "parent:/home",
      "/home/dev/alpha",
    ]);
  });
  it("navigates home again when typing tilde, clears the query and refreshes", () => {
    const context = input({ query: "~" });
    const rows = buildDirectoryBrowserRows(context);
    rows[2]!.select();
    expect(context.navigate).toHaveBeenCalledWith("~");
    expect(context.retry).toHaveBeenCalledOnce();
    expect(context.choose).not.toHaveBeenCalled();
  });
  it("keeps cached children unselectable while refreshing and disables choosing", () => {
    const rows = buildDirectoryBrowserRows(input({ pending: true }));
    expect(rows.map((row) => row.id)).toEqual(["choose:/home/dev", "parent:/home"]);
    expect(rows[0]!.disabled).toBe(true);
  });
  it("offers retry and parent navigation after a failed listing", () => {
    const context = input({ failed: true });
    const rows = buildDirectoryBrowserRows(context);
    expect(rows.map((row) => row.id)).toEqual(["choose:/home/dev", "parent:/home", "retry"]);
    rows[2]!.select();
    expect(context.retry).toHaveBeenCalledOnce();
  });
  it("accepts a listing from a daemon without the optional absolute path", () => {
    const rows = buildDirectoryBrowserRows(
      input({ listing: { path: ".", entries: listing.entries } }),
    );
    expect(rows.map((row) => row.id)).toEqual(["choose:~", "~/alpha", "~/beta"]);
  });
  it.each(["/", "C:\\", "C:/", "\\\\server\\share\\"])("omits parent at root %s", (root) => {
    expect(parentDirectory(root)).toBeNull();
  });
  it.each([
    ["/home/dev", "~", "~"],
    ["/home/dev", "../other", "/home/dev/../other"],
    ["/home/dev", "child/grandchild", "/home/dev/child/grandchild"],
    ["C:\\Users\\dev", "C:\\projects", "C:\\projects"],
    ["C:\\Users\\dev", "\\\\server\\share", "\\\\server\\share"],
    ["/home/dev", "alpha", null],
  ])("resolves navigation from %s with %s", (current, query, target) => {
    expect(directoryNavigationTarget(current, query)).toBe(target);
  });
});
