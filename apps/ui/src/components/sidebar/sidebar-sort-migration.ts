import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSortMode } from "@/stores/sidebar-view-store";

/**
 * Picks the starting sort for someone upgrading from a build without sorting.
 *
 * The drag-order store never recorded whether a person dragged: the sidebar also writes to it on
 * its own, appending newly seen projects (in name order) and prepending newly seen workspaces. So
 * this asks whether the saved order could have come from that bookkeeping alone:
 *
 * - projects: a name-ordered run, then projects appended later, oldest created first and none
 *   created before the newest project in that run;
 * - workspaces in a project: workspaces prepended later, newest created first and none created
 *   before the newest workspace in the name-ordered run that follows.
 *
 * Anything else was arranged by hand and starts on Manual; otherwise Recent activity. Creation
 * times that are unknown (older daemons) never count as evidence of dragging, so the check leans
 * towards Recent activity when it cannot tell.
 *
 * `projects` must be in the structural (name) order the list is built in, with each project's
 * workspaces in that order too.
 */
export function inferLegacySidebarSortMode(input: {
  projects: readonly SidebarProjectEntry[];
  projectOrder: readonly string[];
  workspaceOrderByProject: Readonly<Record<string, readonly string[]>>;
  entriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
}): Extract<SidebarSortMode, "manual" | "recent"> {
  const { projects, entriesByKey } = input;

  const projectIndex = new Map(projects.map((project, index) => [project.viewKey, index]));
  const projectCreated = new Map(
    projects.map((project) => [project.viewKey, projectCreatedAt(project, entriesByKey)]),
  );
  const projectOrder = visibleOrder(input.projectOrder, projectIndex);
  const projectRun = increasingPrefixLength(projectOrder, projectIndex);
  // Appended projects were seen after the initial batch, so none predates its newest member.
  const appended = [
    ...latestKey(projectOrder.slice(0, projectRun), projectCreated),
    ...projectOrder.slice(projectRun),
  ];
  if (!isMonotonic(appended, projectCreated, "ascending")) return "manual";

  for (const project of projects) {
    const stored = input.workspaceOrderByProject[project.viewKey];
    if (!stored || stored.length < 2) continue;
    const workspaceIndex = new Map(
      project.workspaces.map((workspace, index) => [workspace.workspaceKey, index]),
    );
    const order = visibleOrder(stored, workspaceIndex);
    const runStart = increasingSuffixStart(order, workspaceIndex);
    const created = new Map(
      order.map((key) => [key, parseIso(entriesByKey.get(key)?.createdAt)] as const),
    );
    // Prepended workspaces arrived after the initial batch: newest first, none older than it.
    const prepended = [...order.slice(0, runStart), ...latestKey(order.slice(runStart), created)];
    if (!isMonotonic(prepended, created, "descending")) return "manual";
  }
  return "recent";
}

/** The key with the latest known time, as a zero- or one-item list. */
function latestKey(keys: readonly string[], times: ReadonlyMap<string, number | null>): string[] {
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const key of keys) {
    const time = times.get(key) ?? null;
    if (time !== null && time > bestTime) {
      best = key;
      bestTime = time;
    }
  }
  return best === null ? [] : [best];
}

function visibleOrder(order: readonly string[], index: ReadonlyMap<string, number>): string[] {
  const seen = new Set<string>();
  return order.filter((key) => {
    if (!index.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Length of the leading run whose structural indexes increase. */
function increasingPrefixLength(
  order: readonly string[],
  index: ReadonlyMap<string, number>,
): number {
  let length = order.length > 0 ? 1 : 0;
  while (length < order.length) {
    if ((index.get(order[length]) ?? 0) < (index.get(order[length - 1]) ?? 0)) break;
    length += 1;
  }
  return length;
}

/** Start of the trailing run whose structural indexes increase. */
function increasingSuffixStart(
  order: readonly string[],
  index: ReadonlyMap<string, number>,
): number {
  let start = Math.max(order.length - 1, 0);
  while (start > 0) {
    if ((index.get(order[start - 1]) ?? 0) > (index.get(order[start]) ?? 0)) break;
    start -= 1;
  }
  return start;
}

/** Whether the known times follow the direction; unknown times are skipped. */
function isMonotonic(
  keys: readonly string[],
  times: ReadonlyMap<string, number | null>,
  direction: "ascending" | "descending",
): boolean {
  let previous: number | null = null;
  for (const key of keys) {
    const time = times.get(key) ?? null;
    if (time === null) continue;
    if (previous !== null && (direction === "ascending" ? time < previous : time > previous)) {
      return false;
    }
    previous = time;
  }
  return true;
}

function projectCreatedAt(
  project: SidebarProjectEntry,
  entriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
): number | null {
  let earliest: number | null = null;
  for (const workspace of project.workspaces) {
    const entry = entriesByKey.get(workspace.workspaceKey);
    const own = parseIso(entry?.projectCreatedAt);
    if (own !== null) return own;
    const created = parseIso(entry?.createdAt);
    if (created !== null && (earliest === null || created < earliest)) earliest = created;
  }
  return earliest;
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
