import type { DesktopAppUpdateStatus } from "./desktop-app-updater";

interface UpdateToastInput {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  latestVersion: string | null;
  dismissedVersions: ReadonlySet<string>;
}

export function updateToastVersion(input: UpdateToastInput): string | null {
  if (!input.isDesktopApp || !input.latestVersion) return null;
  const canNotify =
    input.status === "available" || input.status === "installing" || input.status === "error";
  if (!canNotify) return null;
  const version = input.latestVersion.replace(/^v/i, "");
  return input.dismissedVersions.has(version) ? null : version;
}
