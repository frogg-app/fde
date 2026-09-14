import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSortMode } from "@/stores/sidebar-view-store";
import { STATUS_BUCKET_ORDER } from "@/utils/sidebar-agent-state";

export interface SidebarSortOptions {
  mode: SidebarSortMode;
  /** Flips the primary key only. Tiebreaks (name, then key) always run ascending. */
  reversed: boolean;
}

/** Whether the sort reads hydrated workspace entries (status, timestamps) rather than placements. */
export function sidebarSortNeedsWorkspaceEntries(mode: SidebarSortMode): boolean {
  return mode === "recent" || mode === "created" || mode === "status";
}

/**
 * The mode the sidebar actually orders by. A saved "date created" choice is kept as-is in the
 * store, but a daemon that does not send creation times has nothing to sort on, so the rows fall
 * back to recent activity until every connected host supports it.
 */
export function resolveEffectiveSidebarSortMode(
  mode: SidebarSortMode,
  createdSortSupported: boolean,
): SidebarSortMode {
  return mode === "created" && !createdSortSupported ? "recent" : mode;
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const UNKNOWN_STATUS_RANK = STATUS_BUCKET_ORDER.length;

/** Most recent of the status-entry time and the daemon's activity time, or null when neither. */
export function sidebarWorkspaceRecency(
  entry: Pick<SidebarWorkspaceEntry, "statusEnteredAt" | "activityAt"> | null | undefined,
): number | null {
  if (!entry) return null;
  const entered = entry.statusEnteredAt?.getTime();
  const activity = entry.activityAt ? Date.parse(entry.activityAt) : Number.NaN;
  const candidates = [entered, activity].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function statusRank(entry: SidebarWorkspaceEntry | null | undefined): number {
  if (!entry) return UNKNOWN_STATUS_RANK;
  const index = STATUS_BUCKET_ORDER.indexOf(entry.statusBucket);
  return index === -1 ? UNKNOWN_STATUS_RANK : index;
}

/** Newest first; items with no timestamp always sink to the bottom regardless of direction. */
function compareRecency(a: number | null, b: number | null, reversed: boolean): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return reversed ? a - b : b - a;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function compareNumber(a: number, b: number, reversed: boolean): number {
  return reversed ? b - a : a - b;
}

interface SortableItem {
  name: string;
  key: string;
  recency: number | null;
  createdAt: number | null;
  statusRank: number;
}

function compareSortable(a: SortableItem, b: SortableItem, options: SidebarSortOptions): number {
  let primary = 0;
  switch (options.mode) {
    case "recent":
      primary = compareRecency(a.recency, b.recency, options.reversed);
      break;
    case "created":
      primary = compareRecency(a.createdAt, b.createdAt, options.reversed);
      break;
    case "name": {
      const cmp = compareText(a.name, b.name);
      primary = options.reversed ? -cmp : cmp;
      break;
    }
    case "status":
      primary =
        a.statusRank === UNKNOWN_STATUS_RANK || b.statusRank === UNKNOWN_STATUS_RANK
          ? a.statusRank - b.statusRank
          : compareNumber(a.statusRank, b.statusRank, options.reversed);
      // Inside one status the freshest change leads, so "needs input" shows the newest ask first.
      if (primary === 0) primary = compareRecency(a.recency, b.recency, false);
      break;
    case "manual":
      return 0;
  }
  if (primary !== 0) return primary;
  // Stable tiebreak so equal rows never swap places as unrelated events stream in.
  const nameCmp = compareText(a.name, b.name);
  if (nameCmp !== 0) return nameCmp;
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

function sortableWorkspace(
  workspace: SidebarWorkspacePlacement,
  entry: SidebarWorkspaceEntry | null | undefined,
): SortableItem {
  return {
    name: entry?.name ?? workspace.name,
    key: workspace.workspaceKey,
    recency: sidebarWorkspaceRecency(entry),
    createdAt: parseIso(entry?.createdAt),
    statusRank: statusRank(entry),
  };
}

/**
 * Orders workspaces by the sort options. `manual` returns the input untouched (same reference) so
 * the stored drag order is what shows. When the order does not change, the input array is returned
 * so memoized consumers keep their references.
 */
export function sortSidebarWorkspaces<T extends SidebarWorkspacePlacement>(
  workspaces: readonly T[],
  entriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
  options: SidebarSortOptions,
): readonly T[] {
  if (options.mode === "manual" || workspaces.length < 2) return workspaces;
  const decorated = workspaces.map((workspace) => ({
    workspace,
    sortable: sortableWorkspace(workspace, entriesByKey.get(workspace.workspaceKey)),
  }));
  decorated.sort((a, b) => compareSortable(a.sortable, b.sortable, options));
  const sorted = decorated.map((item) => item.workspace);
  return sameOrder(sorted, workspaces) ? workspaces : sorted;
}

/**
 * Orders projects and the workspaces inside each one.
 *
 * A project ranks by its best workspace: the most recent activity, or the most urgent status. By
 * date created it ranks by its own creation time, or its earliest workspace when the daemon did
 * not send one. A project with nothing to rank by sinks below those that do (name order).
 */
export function sortSidebarProjects(
  projects: readonly SidebarProjectEntry[],
  entriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
  options: SidebarSortOptions,
): readonly SidebarProjectEntry[] {
  if (options.mode === "manual") return projects;
  let changed = false;
  const decorated = projects.map((project) => {
    const workspaces = sortSidebarWorkspaces(project.workspaces, entriesByKey, options);
    const next =
      workspaces === project.workspaces ? project : { ...project, workspaces: [...workspaces] };
    if (next !== project) changed = true;
    let recency: number | null = null;
    let rank = UNKNOWN_STATUS_RANK;
    let projectCreatedAt: number | null = null;
    let earliestWorkspaceCreatedAt: number | null = null;
    for (const workspace of project.workspaces) {
      const entry = entriesByKey.get(workspace.workspaceKey);
      projectCreatedAt ??= parseIso(entry?.projectCreatedAt);
      const workspaceCreatedAt = parseIso(entry?.createdAt);
      if (
        workspaceCreatedAt !== null &&
        (earliestWorkspaceCreatedAt === null || workspaceCreatedAt < earliestWorkspaceCreatedAt)
      ) {
        earliestWorkspaceCreatedAt = workspaceCreatedAt;
      }
      const workspaceRecency = sidebarWorkspaceRecency(entry);
      if (workspaceRecency !== null && (recency === null || workspaceRecency > recency)) {
        recency = workspaceRecency;
      }
      rank = Math.min(rank, statusRank(entry));
    }
    return {
      project: next,
      sortable: {
        name: project.projectName,
        key: project.viewKey,
        recency,
        createdAt: projectCreatedAt ?? earliestWorkspaceCreatedAt,
        statusRank: rank,
      },
    };
  });
  decorated.sort((a, b) => compareSortable(a.sortable, b.sortable, options));
  const sorted = decorated.map((item) => item.project);
  return !changed && sameOrder(sorted, projects) ? projects : sorted;
}

function sameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
