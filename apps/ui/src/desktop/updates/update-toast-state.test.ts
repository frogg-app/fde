import { describe, expect, it } from "vitest";
import { updateToastVersion } from "./update-toast-state";

const base = {
  isDesktopApp: true,
  status: "available" as const,
  latestVersion: "0.2.3",
  dismissedVersions: new Set<string>(),
};

describe("desktop update notification eligibility", () => {
  it("shows available updates and keeps progress and failures visible", () => {
    for (const status of ["available", "installing", "error"] as const) {
      expect(updateToastVersion({ ...base, status })).toBe("0.2.3");
    }
  });

  it("does not reopen a dismissed version on polling, retry, or prefix changes", () => {
    const dismissedVersions = new Set(["0.2.3"]);
    for (const status of ["available", "installing", "error"] as const) {
      expect(updateToastVersion({ ...base, status, dismissedVersions })).toBeNull();
      expect(
        updateToastVersion({ ...base, status, dismissedVersions, latestVersion: "v0.2.3" }),
      ).toBeNull();
    }
  });

  it("can notify a newer version after the previous one was dismissed", () => {
    expect(updateToastVersion({ ...base, dismissedVersions: new Set(["0.2.2"]) })).toBe("0.2.3");
  });

  it("does not display stale availability while checking or after installing", () => {
    for (const status of ["idle", "checking", "pending", "installed", "up-to-date"] as const) {
      expect(updateToastVersion({ ...base, status })).toBeNull();
    }
  });

  it("does not toast on non-desktop clients or for a failed check without a release", () => {
    expect(updateToastVersion({ ...base, isDesktopApp: false })).toBeNull();
    expect(updateToastVersion({ ...base, status: "error", latestVersion: null })).toBeNull();
  });
});
