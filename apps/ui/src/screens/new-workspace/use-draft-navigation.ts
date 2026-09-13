import { useIsFocused } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { buildNewWorkspaceDraftKey, generateDraftId } from "@/stores/draft-keys";
import {
  EMPTY_SUBMISSION,
  useNewWorkspaceNavigationStore,
  resolveNewWorkspaceNavigationDraft,
  type DraftSubmission,
  type NewWorkspaceNavigationDraft,
} from "@/stores/new-workspace-navigation-store";

export function useNewWorkspaceDraftNavigation(draftId: string | undefined, resumeDraft = false) {
  const key = buildNewWorkspaceDraftKey(draftId);
  const [initialDraft] = useState(() =>
    resolveNewWorkspaceNavigationDraft(
      useNewWorkspaceNavigationStore.getState().drafts[key],
      resumeDraft,
    ),
  );
  const [generation] = useState(() => initialDraft.generation || generateDraftId());
  const submission = useNewWorkspaceNavigationStore(
    (state) => state.submissions[generation] ?? EMPTY_SUBMISSION,
  );
  const isFocused = useIsFocused();
  const remember = useCallback(
    (draft: Omit<NewWorkspaceNavigationDraft, "generation">) => {
      if (isFocused)
        useNewWorkspaceNavigationStore.getState().remember(key, { ...draft, generation });
    },
    [isFocused, key, generation],
  );
  const begin = useCallback(
    (action: NonNullable<DraftSubmission["pendingAction"]>) =>
      useNewWorkspaceNavigationStore.getState().begin(key, generation, action),
    [key, generation],
  );
  const fail = useCallback(
    (message: string) => {
      useNewWorkspaceNavigationStore.getState().fail(generation, message);
    },
    [generation],
  );
  const complete = useCallback(() => {
    useNewWorkspaceNavigationStore.getState().complete(key, generation);
  }, [key, generation]);
  const recordCreatedWorkspace = useCallback(
    (workspace: NonNullable<DraftSubmission["createdWorkspace"]>) => {
      useNewWorkspaceNavigationStore.getState().recordCreatedWorkspace(generation, workspace);
    },
    [generation],
  );
  return { initialDraft, remember, begin, fail, complete, recordCreatedWorkspace, ...submission };
}
