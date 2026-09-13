import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_SUBMISSION,
  useNewWorkspaceNavigationStore,
  resolveNewWorkspaceNavigationDraft,
  type DraftSubmission,
  type NewWorkspaceNavigationDraft,
} from "./new-workspace-navigation-store";

const draft: NewWorkspaceNavigationDraft = {
  generation: "visit-1",
  route: {
    serverId: "host",
    projectId: "project-1",
    sourceDirectory: "C:/projects/app",
    isolation: "worktree",
  },
  pickerSelection: { selectedItem: null, allowAutoPrSelection: false },
  launchTarget: { kind: "chat" },
  terminalPromptText: "npm run dev",
  composerSetup: {
    provider: "codex",
    cwd: "C:/projects/app",
    modeId: "auto-review",
    model: "gpt-6",
    thinkingOptionId: "low",
    featureValues: {},
  },
};
const workspace: NonNullable<DraftSubmission["createdWorkspace"]> = {
  id: "created",
  projectId: "project-1",
  projectDisplayName: "App",
  projectRootPath: "C:/projects/app",
  workspaceDirectory: "C:/worktree",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "created",
  status: "done",
  statusEnteredAt: null,
  archivingAt: null,
  diffStat: null,
  scripts: [],
};
beforeEach(() => useNewWorkspaceNavigationStore.setState({ drafts: {}, submissions: {} }));

describe("new workspace draft navigation", () => {
  it("keeps an unfinished form and restores selections only on explicit resume", () => {
    const store = useNewWorkspaceNavigationStore.getState();
    store.remember("new-workspace", draft);
    expect(resolveNewWorkspaceNavigationDraft(draft, false).route).toEqual({});
    expect(
      resolveNewWorkspaceNavigationDraft(
        useNewWorkspaceNavigationStore.getState().drafts["new-workspace"],
        true,
      ),
    ).toEqual(draft);
  });
  it("does not republish sidebar state for identical selections", () => {
    const store = useNewWorkspaceNavigationStore.getState();
    store.remember("new-workspace", draft);
    const snapshot = useNewWorkspaceNavigationStore.getState().drafts;
    store.remember("new-workspace", {
      ...draft,
      route: { ...draft.route },
      composerSetup: {
        ...draft.composerSetup,
        provider: "codex",
        cwd: "C:/projects/app",
        modeId: "auto-review",
        model: "gpt-6",
        thinkingOptionId: "low",
        featureValues: {},
      },
    });
    expect(useNewWorkspaceNavigationStore.getState().drafts).toBe(snapshot);
  });
  it("shares submission lock and created workspace across resume and retains failures for retry", () => {
    const store = useNewWorkspaceNavigationStore.getState();
    store.remember("new-workspace", draft);
    expect(store.begin("new-workspace", draft.generation, "terminal")).toBe(true);
    // Remounting the resumed form can update selections without replacing its submission owner.
    store.remember("new-workspace", { ...draft, terminalPromptText: "npm test" });
    expect(store.begin("new-workspace", draft.generation, "terminal")).toBe(false);
    store.recordCreatedWorkspace(draft.generation, workspace);
    store.fail(draft.generation, "Terminal failed to launch");
    expect(useNewWorkspaceNavigationStore.getState().submissions[draft.generation]).toEqual({
      ...EMPTY_SUBMISSION,
      createdWorkspace: workspace,
      errorMessage: "Terminal failed to launch",
    });
    expect(store.begin("new-workspace", draft.generation, "terminal")).toBe(true);
    expect(useNewWorkspaceNavigationStore.getState().submissions[draft.generation]).toEqual({
      ...EMPTY_SUBMISSION,
      createdWorkspace: workspace,
      pendingAction: "terminal",
    });
  });
  it("removes a handed-off draft and prevents retained screens from resurrecting it", () => {
    const store = useNewWorkspaceNavigationStore.getState();
    store.remember("new-workspace", draft);
    store.remember("fork-draft", { ...draft, generation: "fork" });
    store.complete("new-workspace", draft.generation);
    store.remember("new-workspace", draft);
    expect(useNewWorkspaceNavigationStore.getState().drafts).toEqual({
      "fork-draft": { ...draft, generation: "fork" },
    });
  });
  it("late completion or failure cannot delete or lock a newer explicit form", () => {
    const store = useNewWorkspaceNavigationStore.getState();
    store.remember("new-workspace", draft);
    expect(store.begin("new-workspace", draft.generation, "chat")).toBe(true);
    const newer = { ...draft, generation: "visit-2", route: { projectId: "other" } };
    store.remember("new-workspace", newer);
    store.recordCreatedWorkspace(draft.generation, workspace);
    store.fail(draft.generation, "Old failure");
    store.complete("new-workspace", draft.generation);
    expect(useNewWorkspaceNavigationStore.getState().drafts["new-workspace"]).toBe(newer);
    expect(store.begin("new-workspace", draft.generation, "chat")).toBe(false);
    expect(store.begin("new-workspace", newer.generation, "chat")).toBe(true);
  });
});
