import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceExplorerToggleOwner,
  shouldShowHeaderExplorerToggle,
  shouldShowSidebarExplorerToggle,
  type WorkspaceExplorerToggleOwner,
} from "./workspace-explorer-toggle";

const DESKTOP_OWNERS: WorkspaceExplorerToggleOwner[] = ["header", "window"];

describe("explorer toggle placement", () => {
  it("moves the control into the sidebar once it is open", () => {
    // The point of the pair: exactly one of them renders on desktop, so the
    // control sits next to what it closes rather than across the window.
    for (const owner of DESKTOP_OWNERS) {
      for (const expanded of [true, false]) {
        expect(
          shouldShowHeaderExplorerToggle({ owner, expanded }) !==
            shouldShowSidebarExplorerToggle({ owner, expanded }),
        ).toBe(true);
      }
    }
  });

  it("shows the header toggle only while the sidebar is collapsed", () => {
    for (const owner of DESKTOP_OWNERS) {
      expect(shouldShowHeaderExplorerToggle({ owner, expanded: false })).toBe(true);
      expect(shouldShowHeaderExplorerToggle({ owner, expanded: true })).toBe(false);
    }
  });

  it("treats every desktop platform alike, not just the one with traffic lights", () => {
    // Previously the sidebar close button was macOS-only ("window"), so on
    // Windows and Linux the open sidebar had no close control of its own.
    expect(shouldShowSidebarExplorerToggle({ owner: "header", expanded: true })).toBe(true);
    expect(shouldShowSidebarExplorerToggle({ owner: "window", expanded: true })).toBe(true);
  });

  it("renders neither control on mobile, which has its own navigation", () => {
    for (const expanded of [true, false]) {
      expect(shouldShowHeaderExplorerToggle({ owner: "mobile", expanded })).toBe(false);
      expect(shouldShowSidebarExplorerToggle({ owner: "mobile", expanded })).toBe(false);
    }
  });

  it("routes owners by platform and window chrome", () => {
    expect(
      resolveWorkspaceExplorerToggleOwner({ isMobile: true, hasMacTrafficLights: false }),
    ).toBe("mobile");
    expect(
      resolveWorkspaceExplorerToggleOwner({ isMobile: false, hasMacTrafficLights: true }),
    ).toBe("window");
    expect(
      resolveWorkspaceExplorerToggleOwner({ isMobile: false, hasMacTrafficLights: false }),
    ).toBe("header");
  });
});
