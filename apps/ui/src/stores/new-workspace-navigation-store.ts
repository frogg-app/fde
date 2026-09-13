import { create } from "zustand";
import { shallow } from "zustand/shallow";
import type { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import type { LaunchTarget } from "@/new-workspace-launch/target";
import type { PickerSelectionState } from "@/screens/new-workspace-picker-state";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import type { buildNewWorkspaceRoute } from "@/utils/host-routes";

/** Session navigation metadata; text and attachments remain owned by the draft store. */
export interface NewWorkspaceNavigationDraft {
  generation: string;
  route: NonNullable<Parameters<typeof buildNewWorkspaceRoute>[0]>;
  pickerSelection: PickerSelectionState;
  launchTarget: LaunchTarget | null;
  terminalPromptText: string;
  composerSetup?: WorkspaceDraftTabSetup;
}

export interface DraftSubmission {
  pendingAction: "chat" | "empty" | "terminal" | null;
  errorMessage: string | null;
  createdWorkspace: ReturnType<typeof normalizeWorkspaceDescriptor> | null;
  completed: boolean;
}

export const EMPTY_SUBMISSION: DraftSubmission = {
  pendingAction: null,
  errorMessage: null,
  createdWorkspace: null,
  completed: false,
};
const EMPTY_DRAFT: NewWorkspaceNavigationDraft = {
  generation: "",
  route: {},
  pickerSelection: { selectedItem: null, allowAutoPrSelection: false },
  launchTarget: null,
  terminalPromptText: "",
};

export function resolveNewWorkspaceNavigationDraft(
  draft: NewWorkspaceNavigationDraft | undefined,
  resumeDraft: boolean,
): NewWorkspaceNavigationDraft {
  return (resumeDraft ? draft : undefined) ?? EMPTY_DRAFT;
}

interface NewWorkspaceNavigationState {
  drafts: Record<string, NewWorkspaceNavigationDraft>;
  submissions: Record<string, DraftSubmission>;
  remember: (key: string, draft: NewWorkspaceNavigationDraft) => void;
  begin: (
    key: string,
    generation: string,
    action: NonNullable<DraftSubmission["pendingAction"]>,
  ) => boolean;
  fail: (generation: string, message: string) => void;
  complete: (key: string, generation: string) => void;
  recordCreatedWorkspace: (
    generation: string,
    workspace: NonNullable<DraftSubmission["createdWorkspace"]>,
  ) => void;
}

export const useNewWorkspaceNavigationStore = create<NewWorkspaceNavigationState>((set, get) => ({
  drafts: {},
  submissions: {},
  remember: (key, draft) =>
    set((state) => {
      // A retained screen cannot resurrect a draft after its submission handed off.
      if (state.submissions[draft.generation]?.completed) return state;
      const previous = state.drafts[key];
      if (
        previous &&
        previous.generation === draft.generation &&
        shallow(previous.route, draft.route) &&
        shallow(previous.pickerSelection, draft.pickerSelection) &&
        shallow(previous.launchTarget, draft.launchTarget) &&
        previous.terminalPromptText === draft.terminalPromptText &&
        shallow(
          { ...previous.composerSetup, featureValues: undefined },
          { ...draft.composerSetup, featureValues: undefined },
        ) &&
        shallow(previous.composerSetup?.featureValues, draft.composerSetup?.featureValues)
      )
        return state;
      return { drafts: { ...state.drafts, [key]: draft } };
    }),
  begin: (key, generation, pendingAction) => {
    const state = get();
    const submission = state.submissions[generation] ?? EMPTY_SUBMISSION;
    if (
      state.drafts[key]?.generation !== generation ||
      submission.pendingAction ||
      submission.completed
    )
      return false;
    set({
      submissions: {
        ...state.submissions,
        [generation]: { ...submission, pendingAction, errorMessage: null },
      },
    });
    return true;
  },
  fail: (generation, errorMessage) =>
    set((state) => ({
      submissions: {
        ...state.submissions,
        [generation]: {
          ...(state.submissions[generation] ?? EMPTY_SUBMISSION),
          pendingAction: null,
          errorMessage,
        },
      },
    })),
  recordCreatedWorkspace: (generation, createdWorkspace) =>
    set((state) => ({
      submissions: {
        ...state.submissions,
        [generation]: { ...(state.submissions[generation] ?? EMPTY_SUBMISSION), createdWorkspace },
      },
    })),
  complete: (key, generation) =>
    set((state) => {
      const submissions = {
        ...state.submissions,
        [generation]: { ...EMPTY_SUBMISSION, completed: true },
      };
      if (state.drafts[key]?.generation !== generation) return { submissions };
      const { [key]: _removed, ...drafts } = state.drafts;
      return { drafts, submissions };
    }),
}));
