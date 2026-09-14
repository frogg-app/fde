import type { FileExplorerResponse } from "@frogg/protocol/messages";
import type { ComponentType } from "react";
import { ArrowUp, Folder, FolderPlus, RotateCw } from "lucide-react-native";
import { i18n } from "@/i18n/i18next";
import { shortenPath } from "@/utils/shorten-path";
import { joinDirectoryPath, parentDirectory } from "./options";

type DirectoryListing = NonNullable<FileExplorerResponse["payload"]["directory"]>;

interface DirectoryBrowserInput {
  directory: string;
  query: string;
  listing: DirectoryListing | undefined;
  pending: boolean;
  showHiddenFolders: boolean;
  failed: boolean;
  navigate: (path: string) => void;
  choose: (path: string) => void;
  retry: () => void;
}

interface DirectoryBrowserRow {
  id: string;
  title: string;
  subtitle: string | null;
  icon: ComponentType<{ size?: number; color?: string }>;
  pinned?: boolean;
  disabled?: boolean;
  testID: string;
  select: () => void;
}

export function directoryNavigationTarget(currentPath: string, query: string): string | null {
  const typed = query.trim();
  if (!typed) return null;
  if (/^(~(?:[\\/]|$)|\/|\\\\|[A-Za-z]:[\\/])/.test(typed)) return typed;
  if (typed === "." || typed === ".." || /[\\/]/.test(typed)) {
    return joinDirectoryPath(currentPath, typed);
  }
  return null;
}

/** Dot-prefixed folders are hidden from listings unless the user opts in. */
export function isVisibleDirectoryName(name: string, showHiddenFolders: boolean): boolean {
  return showHiddenFolders || !name.startsWith(".");
}

export function buildDirectoryBrowserRows(input: DirectoryBrowserInput): DirectoryBrowserRow[] {
  const { listing, pending, failed, navigate, choose } = input;
  // COMPAT(directoryAbsolutePath): older 0.6 daemons omit the resolved path.
  // Remove once the daemon floor includes this field (after 2027-03-13).
  const currentPath = listing?.absolutePath ?? input.directory;
  const parent = parentDirectory(currentPath);
  const rows: DirectoryBrowserRow[] = [
    {
      id: `choose:${currentPath}`,
      title: i18n.t("directoryBrowser.choose"),
      subtitle: shortenPath(currentPath),
      icon: FolderPlus,
      pinned: true,
      disabled: !listing || failed || pending,
      testID: "add-project-flow-choose-directory",
      select: () => choose(currentPath),
    },
  ];
  if (parent)
    rows.push({
      id: `parent:${parent}`,
      title: i18n.t("directoryBrowser.parent"),
      subtitle: shortenPath(parent),
      icon: ArrowUp,
      pinned: true,
      testID: "add-project-flow-parent-directory",
      select: () => navigate(parent),
    });
  if (failed)
    rows.push({
      id: "retry",
      title: i18n.t("common.actions.retry"),
      subtitle: null,
      icon: RotateCw,
      testID: "add-project-flow-retry-directory",
      select: input.retry,
    });
  const target = directoryNavigationTarget(currentPath, input.query);
  if (target)
    rows.push({
      id: `navigate:${target}`,
      title: i18n.t("directoryBrowser.navigatePath", { path: input.query.trim() }),
      subtitle: null,
      icon: Folder,
      testID: "add-project-flow-navigate-directory",
      select: () => {
        navigate(target);
        if (target === input.directory) input.retry();
      },
    });
  if (!listing || pending || failed || target) return rows;
  const filter = input.query.trim().toLowerCase();
  const directories = listing.entries.filter(
    (entry) =>
      entry.kind === "directory" &&
      isVisibleDirectoryName(entry.name, input.showHiddenFolders) &&
      entry.name.toLowerCase().includes(filter),
  );
  directories.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true }),
  );
  for (const entry of directories) {
    const childPath = joinDirectoryPath(currentPath, entry.name);
    rows.push({
      id: childPath,
      title: entry.name,
      subtitle: i18n.t("directoryBrowser.navigate"),
      icon: Folder,
      testID: `add-project-flow-path-${encodeURIComponent(childPath)}`,
      select: () => navigate(childPath),
    });
  }
  return rows;
}
