import { describe, expect, it } from "vitest";

import type { CheckoutStatusPayload } from "@/git/use-status-query";
import {
  parseAgentKey,
  resolveNewAgentPlacement,
  resolveNewAgentWorkingDir,
  resolveSelectedAgentForNewAgent,
} from "./new-agent-routing";

describe("resolveNewAgentWorkingDir", () => {
  it("returns the current cwd for regular checkouts", () => {
    expect(resolveNewAgentWorkingDir("/repo/path", null)).toBe("/repo/path");
  });

  it("falls back to repo root when checkout metadata is unavailable", () => {
    expect(resolveNewAgentWorkingDir("/repo/.paseo/worktrees/feature", null)).toBe("/repo");
  });

  it("supports windows-style paseo worktree paths without checkout metadata", () => {
    expect(resolveNewAgentWorkingDir("C:\\Users\\me\\repo\\.paseo\\worktrees\\feature", null)).toBe(
      "C:\\Users\\me\\repo",
    );
  });

  it("returns the main repo root for paseo-owned worktrees", () => {
    const checkout = {
      isPaseoOwnedWorktree: true,
      worktreeRoot: "/repo/.paseo/worktrees/feature",
      mainRepoRoot: "/repo/main",
    } as unknown as CheckoutStatusPayload;

    expect(resolveNewAgentWorkingDir("/repo/.paseo/worktrees/feature", checkout)).toBe(
      "/repo/main",
    );
  });
});

describe("parseAgentKey", () => {
  it("parses server and agent ids from combined key", () => {
    expect(parseAgentKey("srv-1:agent-9")).toEqual({
      serverId: "srv-1",
      agentId: "agent-9",
    });
  });

  it("uses the last separator to preserve server ids with colons", () => {
    expect(parseAgentKey("localhost:6767:agent-9")).toEqual({
      serverId: "localhost:6767",
      agentId: "agent-9",
    });
  });

  it("returns null for malformed keys", () => {
    expect(parseAgentKey("")).toBeNull();
    expect(parseAgentKey("only-server")).toBeNull();
    expect(parseAgentKey(":agent-1")).toBeNull();
    expect(parseAgentKey("srv-1:")).toBeNull();
  });
});

describe("resolveSelectedAgentForNewAgent", () => {
  it("prefers the agent in the current route", () => {
    expect(
      resolveSelectedAgentForNewAgent({
        pathname: "/h/srv-1/workspace/L3JlcG8?open=agent%3Aagent-2",
        selectedAgentId: "srv-9:agent-9",
      }),
    ).toEqual({
      serverId: "srv-1",
      agentId: "agent-2",
    });
  });

  it("falls back to selected agent key when route has no agent", () => {
    expect(
      resolveSelectedAgentForNewAgent({
        pathname: "/h/srv-1/settings",
        selectedAgentId: "srv-1:agent-7",
      }),
    ).toEqual({
      serverId: "srv-1",
      agentId: "agent-7",
    });
  });

  it("returns null when neither route nor selection has an agent", () => {
    expect(
      resolveSelectedAgentForNewAgent({
        pathname: "/h/srv-1/settings",
      }),
    ).toBeNull();
  });
});

describe("resolveNewAgentPlacement", () => {
  const worktreeWorkspace = {
    projectKind: "git",
    worktreeSlug: "brave-otter",
    projectRootPath: "/repo",
    projectId: "project-1",
  };

  it("sends a worktree workspace to a worktree of its own, cut from the main repo", () => {
    expect(resolveNewAgentPlacement({ serverId: "srv-1", workspace: worktreeWorkspace })).toEqual({
      kind: "new-worktree",
      serverId: "srv-1",
      sourceDirectory: "/repo",
      projectId: "project-1",
    });
  });

  it("keeps a plain checkout in the same workspace", () => {
    expect(
      resolveNewAgentPlacement({
        serverId: "srv-1",
        workspace: { ...worktreeWorkspace, worktreeSlug: null },
      }),
    ).toEqual({ kind: "same-workspace" });
  });

  it("keeps non-git projects in the same workspace", () => {
    expect(
      resolveNewAgentPlacement({
        serverId: "srv-1",
        workspace: { ...worktreeWorkspace, projectKind: "plain" },
      }),
    ).toEqual({ kind: "same-workspace" });
  });

  it("falls back when the host or the workspace metadata is missing", () => {
    expect(resolveNewAgentPlacement({ serverId: null, workspace: worktreeWorkspace })).toEqual({
      kind: "same-workspace",
    });
    expect(resolveNewAgentPlacement({ serverId: "  ", workspace: worktreeWorkspace })).toEqual({
      kind: "same-workspace",
    });
    expect(resolveNewAgentPlacement({ serverId: "srv-1", workspace: null })).toEqual({
      kind: "same-workspace",
    });
    expect(
      resolveNewAgentPlacement({
        serverId: "srv-1",
        workspace: { ...worktreeWorkspace, projectRootPath: "  " },
      }),
    ).toEqual({ kind: "same-workspace" });
    expect(
      resolveNewAgentPlacement({
        serverId: "srv-1",
        workspace: { ...worktreeWorkspace, projectId: undefined },
      }),
    ).toEqual({ kind: "same-workspace" });
  });
});
