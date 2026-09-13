import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { FilePenLine } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { buildNewWorkspaceDraftKey } from "@/stores/draft-keys";
import {
  useNewWorkspaceNavigationStore,
  type NewWorkspaceNavigationDraft,
} from "@/stores/new-workspace-navigation-store";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { SidebarHeaderRow } from "./sidebar-header-row";

export function SidebarWorkspaceDrafts({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const drafts = useNewWorkspaceNavigationStore((state) => state.drafts);
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ draftId?: string }>();
  const activeKey = buildNewWorkspaceDraftKey(
    typeof params.draftId === "string" ? params.draftId : undefined,
  );
  return (
    <View>
      {Object.entries(drafts).map(([key, draft]) => (
        <DraftRow
          key={key}
          draftKey={key}
          draft={draft}
          isActive={pathname === "/new" && activeKey === key}
          onBeforeNavigate={onBeforeNavigate}
        />
      ))}
    </View>
  );
}

function DraftRow({
  draftKey,
  draft,
  isActive,
  onBeforeNavigate,
}: {
  draftKey: string;
  draft: NewWorkspaceNavigationDraft;
  isActive: boolean;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.navigate(buildNewWorkspaceRoute({ ...draft.route, resumeDraft: true }));
  }, [draft.route, onBeforeNavigate]);
  const label = draft.route.displayName
    ? `${t("sidebar.workspaceDraft")} · ${draft.route.displayName}`
    : t("sidebar.workspaceDraft");
  return (
    <SidebarHeaderRow
      icon={FilePenLine}
      label={label}
      isActive={isActive}
      testID={`sidebar-workspace-draft-${draftKey}`}
      variant="compact"
      onPress={handlePress}
    />
  );
}
