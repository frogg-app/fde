import { router, usePathname } from "expo-router";
import { AudioLines, History, Home, Search } from "lucide-react-native";
import { useCallback, useMemo, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { PluginSidebarItemRow } from "@/plugins/sidebar-items";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { useCompanionStore } from "@/companion/store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { buildOpenProjectRoute, buildSessionsRoute } from "@/utils/host-routes";

interface SidebarNavRowProps {
  onBeforeNavigate?: () => void;
}

interface SidebarNavRowsProps extends SidebarNavRowProps {
  /** Style for the group wrapper, which the sidebar owns. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Top-level sidebar navigation, ordered and filtered by the user's
 * `sidebarNavItems` preference. Renders nothing — not even the bordered group
 * wrapper — when every item is hidden.
 */
export function SidebarNavRows({ style, onBeforeNavigate }: SidebarNavRowsProps) {
  const { items } = useSidebarNavItems();
  const visibleItems = useMemo(() => items.filter((item) => item.visible), [items]);

  if (visibleItems.length === 0) return null;

  return (
    <View style={style}>
      {visibleItems.map((item) => {
        if (item.kind === "plugin") {
          return (
            <PluginSidebarItemRow
              key={item.key}
              group={item.group}
              onBeforeNavigate={onBeforeNavigate}
            />
          );
        }
        const Row = BUILTIN_ROWS[item.id];
        return <Row key={item.key} onBeforeNavigate={onBeforeNavigate} />;
      })}
    </View>
  );
}

function SidebarHomeRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildOpenProjectRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Home}
      label={t(builtinSidebarNavLabelKey("home"))}
      onPress={handlePress}
      isActive={pathname === buildOpenProjectRoute()}
      testID="sidebar-home"
      nativeID="sidebar-home"
      variant="compact"
    />
  );
}

function SidebarHistoryRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSessionsRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={History}
      label={t(builtinSidebarNavLabelKey("history"))}
      onPress={handlePress}
      isActive={pathname.includes("/sessions")}
      testID="sidebar-sessions"
      variant="compact"
    />
  );
}

function SidebarCompanionRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("companion"));
  const openCompanion = useCompanionStore((state) => state.open);
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    openCompanion();
  }, [onBeforeNavigate, openCompanion]);

  return (
    <SidebarHeaderRow
      icon={AudioLines}
      label={t(builtinSidebarNavLabelKey("companion"))}
      onPress={handlePress}
      testID="sidebar-companion"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarSearchRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    setCommandCenterOpen(true);
  }, [onBeforeNavigate, setCommandCenterOpen]);

  return (
    <SidebarHeaderRow
      icon={Search}
      label={t(builtinSidebarNavLabelKey("search"))}
      onPress={handlePress}
      testID="sidebar-search"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

const BUILTIN_ROWS: Record<BuiltinSidebarNavId, ComponentType<SidebarNavRowProps>> = {
  home: SidebarHomeRow,
  companion: SidebarCompanionRow,
  history: SidebarHistoryRow,
  search: SidebarSearchRow,
};
