import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from "react";
import type { GestureResponderEvent } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useSidebarAgents } from "./provider";
import type { SidebarAgentNode } from "./model";

const EMPTY_NODES: SidebarAgentNode[] = [];
interface WorkspaceAgentTree {
  nodes: SidebarAgentNode[];
  expanded: boolean;
  singleRootKey: string | undefined;
  toggle: () => void;
}
const WorkspaceAgentTreeContext = createContext<WorkspaceAgentTree>({
  nodes: EMPTY_NODES,
  expanded: false,
  singleRootKey: undefined,
  toggle: () => {},
});

/** A single root is represented by the workspace itself; only its live children need rows. */
export function WorkspaceAgentTreeScope({
  serverId,
  workspaceId,
  children,
}: {
  serverId: string;
  workspaceId: string;
  children: ReactNode;
}) {
  const { trees } = useSidebarAgents();
  const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const roots = key ? (trees.get(key) ?? EMPTY_NODES) : EMPTY_NODES;
  return <WorkspaceAgentTreeState roots={roots}>{children}</WorkspaceAgentTreeState>;
}

export function WorkspaceAgentTreeState({
  roots,
  children,
}: {
  roots: SidebarAgentNode[];
  children: ReactNode;
}) {
  const nodes = roots.length === 1 ? roots[0].children : roots;
  const [expandedOverride, setExpanded] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? nodes.length > 0;
  const toggle = useCallback(() => setExpanded(!expanded), [expanded]);
  const singleRootKey = roots.length === 1 ? roots[0].key : undefined;
  const value = useMemo(
    () => ({ nodes, expanded, singleRootKey, toggle }),
    [nodes, expanded, singleRootKey, toggle],
  );
  return (
    <WorkspaceAgentTreeContext.Provider value={value}>
      {children}
    </WorkspaceAgentTreeContext.Provider>
  );
}

export function useSidebarWorkspaceTarget(workspace: { serverId: string; workspaceId: string }) {
  const { trees } = useSidebarAgents();
  const key = buildWorkspaceTabPersistenceKey(workspace);
  const roots = key ? trees.get(key) : undefined;
  return roots?.length === 1 ? roots[0].target : undefined;
}

export function useWorkspaceAgentTree() {
  return useContext(WorkspaceAgentTreeContext);
}

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const chevronProps = (theme: Theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
});

export function WorkspaceAgentDisclosure({ label }: { label: string }) {
  const { t } = useTranslation();
  const { nodes, expanded, toggle } = useWorkspaceAgentTree();
  const state = useMemo(() => ({ expanded }), [expanded]);
  const onPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      toggle();
    },
    [toggle],
  );
  if (nodes.length === 0) return null;
  const Chevron = expanded ? ThemedChevronDown : ThemedChevronRight;
  return (
    <Button
      variant="ghost"
      size="xs"
      style={styles.disclosure}
      accessibilityLabel={t(
        expanded ? "subagents.collapseWorkspace" : "subagents.expandWorkspace",
        { label },
      )}
      accessibilityState={state}
      aria-expanded={expanded}
      onPress={onPress}
    >
      <Chevron uniProps={chevronProps} />
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  disclosure: { width: theme.spacing[4], paddingHorizontal: 0, flexShrink: 0 },
}));
