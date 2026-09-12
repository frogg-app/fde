import { memo, useState, useMemo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getProviderIcon } from "@/components/provider-icons";
import { WorkspaceTabIcon } from "@/screens/workspace/workspace-tab-presentation";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { buildSubagentRowPresentationData } from "@/subagents/track-presentation";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useSettings } from "@/hooks/use-settings";
import { useSidebarAgents, type ChildDiscovery } from "./provider";
import type { Theme } from "@/styles/theme";
import type { SidebarAgentNode } from "./model";
import { useWorkspaceAgentTree } from "./workspace-tree";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const chevronProps = (theme: Theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
});

export function SidebarWorkspaceAgents({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { discovery, offlineHosts } = useSidebarAgents();
  const { nodes, expanded, singleRootKey } = useWorkspaceAgentTree();
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const selection = useActiveWorkspaceSelection();
  const isActiveWorkspace =
    selection?.serverId === serverId && selection.workspaceId === workspaceId;
  const selectedTarget = useWorkspaceLayoutStore((state) => {
    const layout = workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined;
    if (!layout || !isActiveWorkspace) return null;
    const pane = findPaneById(layout.root, layout.focusedPaneId);
    return (
      collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)?.target ?? null
    );
  });
  const isCompact = useIsCompactFormFactor();
  const preferences = useSettings((settings) => settings.openInSidePane);
  const open = useCallback(
    (node: SidebarAgentNode) => {
      const key = buildWorkspaceTabPersistenceKey(node);
      openPreferredWorkspaceTarget({
        isCompact,
        workspaceKey: key,
        target: node.target,
        source: "subagents",
        preferences,
      });
      navigateToWorkspace({
        serverId: node.serverId,
        workspaceId: node.workspaceId,
        target: node.target,
      });
      if (isCompact) usePanelStore.getState().showMobileAgent();
    },
    [isCompact, preferences],
  );
  if (!expanded || nodes.length === 0) return null;
  return (
    <View style={styles.tree} testID={`sidebar-agents-${workspaceId}`}>
      {singleRootKey ? (
        <ChildDiscoveryStatus
          offline={offlineHosts.has(serverId)}
          load={discovery.get(singleRootKey)}
        />
      ) : null}
      {nodes.map((node) => (
        <SidebarAgentBranch
          key={node.key}
          node={node}
          discovery={discovery}
          offline={offlineHosts.has(serverId)}
          selectedTarget={selectedTarget}
          onOpen={open}
        />
      ))}
    </View>
  );
}

export const SidebarAgentBranch = memo(function SidebarAgentBranch({
  node,
  discovery,
  offline,
  selectedTarget,
  onOpen,
}: {
  node: SidebarAgentNode;
  discovery: ReadonlyMap<string, ChildDiscovery>;
  offline: boolean;
  selectedTarget: WorkspaceTabTarget | null;
  onOpen: (node: SidebarAgentNode) => void;
}) {
  const { t } = useTranslation();
  const [expandedOverride, setExpanded] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? node.children.length > 0;
  const data = buildSubagentRowPresentationData(node.row);
  const label = data.titleState === "loading" ? t("common.states.loading") : data.label;
  const statusBucket =
    node.row.kind === "paseo" ? deriveSidebarStateBucket(node.row) : data.statusBucket;
  const presentation = useMemo(
    () => ({
      ...data,
      tooltip: label,
      modified: false,
      icon: getProviderIcon(node.row.provider),
      statusBucket: offline ? null : statusBucket,
    }),
    [data, label, node.row.provider, offline, statusBucket],
  );
  const selected = selectedTarget !== null && workspaceTabTargetsEqual(selectedTarget, node.target);
  const load = discovery.get(node.key);
  const hasChildren = node.children.length > 0;
  const canExpand = hasChildren;
  const Chevron = expanded ? ThemedChevronDown : ThemedChevronRight;
  const disclosureState = useMemo(() => ({ expanded }), [expanded]);
  const selectionState = useMemo(() => ({ selected }), [selected]);
  const toggle = useCallback(() => {
    if (!expanded) load?.discover();
    setExpanded(!expanded);
  }, [expanded, load]);
  const open = useCallback(() => onOpen(node), [node, onOpen]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.link,
      hovered && styles.hovered,
      pressed && styles.hovered,
      selected && styles.selected,
    ],
    [selected],
  );
  return (
    <View>
      <View style={styles.row}>
        {canExpand ? (
          <Button
            variant="ghost"
            size="xs"
            style={styles.disclosure}
            accessibilityLabel={t(expanded ? "subagents.collapse" : "subagents.expand", { label })}
            accessibilityState={disclosureState}
            aria-expanded={expanded}
            onPress={toggle}
          >
            <Chevron uniProps={chevronProps} />
          </Button>
        ) : (
          <View style={styles.disclosure} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={selectionState}
          aria-selected={selected}
          testID={`sidebar-agent-${node.row.kind}-${node.row.id}`}
          onPress={open}
          style={rowStyle}
        >
          <WorkspaceTabIcon
            presentation={presentation}
            backdrop={selected ? "surfaceSidebarSelected" : "surfaceSidebar"}
          />
          <View style={styles.labels}>
            <Text numberOfLines={1} style={styles.label}>
              {label}
            </Text>
            {data.subtitle ? (
              <Text numberOfLines={1} style={styles.detail}>
                {data.subtitle}
              </Text>
            ) : null}
          </View>
          {hasChildren ? <Text style={styles.detail}>{node.children.length}</Text> : null}
        </Pressable>
      </View>
      {expanded && canExpand ? (
        <View style={styles.children}>
          <ChildDiscoveryStatus offline={offline} load={load} />
          {node.children.map((child) => (
            <SidebarAgentBranch
              key={child.key}
              node={child}
              discovery={discovery}
              offline={offline}
              selectedTarget={selectedTarget}
              onOpen={onOpen}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function ChildDiscoveryStatus({
  offline,
  load,
}: {
  offline: boolean;
  load: ChildDiscovery | undefined;
}) {
  const { t } = useTranslation();
  if (offline) return <Text style={styles.detail}>{t("subagents.offline")}</Text>;
  if (load?.pending) return <Text style={styles.detail}>{t("common.states.loading")}</Text>;
  if (load?.failed)
    return (
      <Button variant="ghost" size="xs" onPress={load.retry}>
        {t("subagents.loadFailedRetry")}
      </Button>
    );
  return null;
}

const styles = StyleSheet.create((theme) => ({
  tree: { paddingLeft: theme.spacing[2], marginBottom: theme.spacing[2] },
  row: { flexDirection: "row", alignItems: "center" },
  disclosure: { width: 28, paddingHorizontal: 0, flexShrink: 0 },
  link: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  labels: { flex: 1, minWidth: 0 },
  label: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  detail: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  children: { paddingLeft: theme.spacing[4] },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  selected: { backgroundColor: theme.colors.surfaceSidebarSelected },
}));
