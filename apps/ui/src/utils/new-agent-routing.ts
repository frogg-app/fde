import type { CheckoutStatusPayload } from "@/git/use-status-query";
import {
  parseHostWorkspaceOpenIntentFromPathname,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";

export function parseAgentKey(
  key: string | null | undefined,
): { serverId: string; agentId: string } | null {
  if (!key) {
    return null;
  }
  const sep = key.lastIndexOf(":");
  if (sep <= 0 || sep >= key.length - 1) {
    return null;
  }
  const serverId = key.slice(0, sep).trim();
  const agentId = key.slice(sep + 1).trim();
  if (!serverId || !agentId) {
    return null;
  }
  return { serverId, agentId };
}

export function resolveSelectedAgentForNewAgent(input: {
  pathname: string;
  selectedAgentId?: string;
}): { serverId: string; agentId: string } | null {
  const workspaceRoute = parseHostWorkspaceRouteFromPathname(input.pathname);
  const openIntent = parseHostWorkspaceOpenIntentFromPathname(input.pathname);
  if (workspaceRoute && openIntent?.kind === "agent") {
    const agentId = openIntent.agentId.trim();
    if (agentId) {
      return { serverId: workspaceRoute.serverId, agentId };
    }
  }
  return parseHostAgentRouteFromPathname(input.pathname) ?? parseAgentKey(input.selectedAgentId);
}

function inferMainRepoRootFromPaseoWorktreePath(cwd: string): string | null {
  const normalizedPath = cwd.replace(/\\/g, "/");
  const marker = "/.paseo/worktrees";
  const markerIndex = normalizedPath.indexOf(marker);
  if (markerIndex <= 0) {
    return null;
  }
  const markerEnd = markerIndex + marker.length;
  const nextChar = normalizedPath[markerEnd];
  if (nextChar && nextChar !== "/") {
    return null;
  }
  const inferred = cwd.slice(0, markerIndex).replace(/[\\/]+$/, "");
  return inferred.trim() ? inferred : null;
}

export function resolveNewAgentWorkingDir(
  cwd: string,
  checkout: CheckoutStatusPayload | null,
): string {
  const explicitMainRepoRoot = checkout?.isPaseoOwnedWorktree
    ? checkout.mainRepoRoot?.trim() || null
    : null;
  if (explicitMainRepoRoot) {
    return explicitMainRepoRoot;
  }

  return inferMainRepoRootFromPaseoWorktreePath(cwd) ?? cwd;
}

/**
 * Where a "New agent" action should put the agent. Compact layouts have no tab
 * strip, so the workspace menu is the only way to start one, and tapping it
 * inside a worktree used to add a second agent to that same worktree without
 * saying so. From a worktree the default is now a worktree of its own; the
 * caller keeps an explicit item for the old behaviour.
 */
export type NewAgentPlacement =
  | { kind: "same-workspace" }
  | { kind: "new-worktree"; serverId: string; sourceDirectory: string; projectId: string };

const SAME_WORKSPACE: NewAgentPlacement = { kind: "same-workspace" };

export function resolveNewAgentPlacement(input: {
  serverId: string | null | undefined;
  workspace:
    | {
        worktreeSlug?: string | null;
        projectKind?: string | null;
        projectRootPath?: string | null;
        projectId?: string | null;
      }
    | null
    | undefined;
}): NewAgentPlacement {
  const serverId = input.serverId?.trim();
  const workspace = input.workspace;
  if (!serverId || !workspace) {
    return SAME_WORKSPACE;
  }
  // Only a git checkout can have a worktree, and only a workspace that already
  // sits in one has something to branch away from.
  if (workspace.projectKind !== "git" || !workspace.worktreeSlug?.trim()) {
    return SAME_WORKSPACE;
  }
  // The new worktree is cut from the main repo, not from this worktree.
  const sourceDirectory = workspace.projectRootPath?.trim();
  const projectId = workspace.projectId?.trim();
  if (!sourceDirectory || !projectId) {
    return SAME_WORKSPACE;
  }
  return { kind: "new-worktree", serverId, sourceDirectory, projectId };
}
