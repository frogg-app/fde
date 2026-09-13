import { useCallback, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { isElectronRuntime } from "@/desktop/host";
import { SETTINGS_DESKTOP_SIDEBAR_WIDTH } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import { resolveSettingsScope, type SettingsView } from "@/navigation/settings-navigation";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { HOST_SECTION_ITEMS, SIDEBAR_SECTION_ITEMS } from "@/screens/settings/section-items";

type SidebarIcon = ComponentType<{ size: number; color: string }>;

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function NavIcon({ Icon, color = "" }: { Icon: SidebarIcon; color?: string }) {
  return <Icon size={ICON_SIZE.md} color={color} />;
}

const ThemedNavIcon = withUnistyles(NavIcon);

function sidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [sidebarStyles.item, Boolean(hovered) && sidebarStyles.itemHovered];
}

function selectedSidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
  ];
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: SidebarIcon;
  isSelected: boolean;
  onSelect: (section: SettingsSectionSlug) => void;
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarSectionButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      aria-selected={isSelected}
      onPress={handlePress}
      testID={`settings-section-${itemId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <ThemedNavIcon
        Icon={IconComponent}
        uniProps={isSelected ? foregroundColorMapping : mutedColorMapping}
      />
      <Text
        style={[sidebarStyles.label, isSelected && sidebarStyles.labelSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface SidebarHostSectionButtonProps {
  itemId: HostSectionSlug;
  label: string;
  icon: SidebarIcon;
  isSelected: boolean;
  onSelect: (section: HostSectionSlug) => void;
}

function SidebarHostSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarHostSectionButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      // React Native Web does not project `accessibilityState.selected` onto
      // the DOM, so the selected row would have no aria-selected without this.
      aria-selected={isSelected}
      onPress={handlePress}
      testID={`settings-host-section-${itemId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <ThemedNavIcon
        Icon={IconComponent}
        uniProps={isSelected ? foregroundColorMapping : mutedColorMapping}
      />
      <Text
        style={[sidebarStyles.label, isSelected && sidebarStyles.labelSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  /** `desktop` is the scrolling nav column beside the detail pane; `mobile` is the root list. */
  layout: "desktop" | "mobile";
}

/**
 * The settings nav. App settings and host settings are separate surfaces, so
 * the view's scope decides which list it shows: app sections, or the sections
 * of the one host being managed (hosts are switched from the sidebar's Hosts menu).
 */
export function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHostSection,
  layout,
}: SettingsSidebarProps) {
  const { t } = useTranslation();
  const isDesktopApp = isElectronRuntime();
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const scope = resolveSettingsScope(view);
  const isDesktop = layout === "desktop";

  let sidebarBody: ReactNode;
  if (scope.kind === "host") {
    let selectedHostSection: HostSectionSlug | null = null;
    if (view.kind === "host") selectedHostSection = view.section;
    if (view.kind === "project") selectedHostSection = "projects";
    sidebarBody = (
      <View style={sidebarStyles.list}>
        {HOST_SECTION_ITEMS.map((item) => (
          <SidebarHostSectionButton
            key={item.id}
            itemId={item.id}
            label={t(item.labelKey)}
            icon={item.icon}
            isSelected={selectedHostSection === item.id}
            onSelect={onSelectHostSection}
          />
        ))}
      </View>
    );
  } else {
    const selectedSectionId = view.kind === "section" ? view.section : null;
    const items = SIDEBAR_SECTION_ITEMS.filter(
      (item) =>
        (!item.desktopOnly || isDesktopApp) &&
        (!item.webOnly || isWeb) &&
        (!item.requiresKeyboardShortcuts || shortcutsAvailable),
    );
    sidebarBody = (
      <View style={sidebarStyles.list}>
        {items.map((item) => (
          <SidebarSectionButton
            key={item.id}
            itemId={item.id}
            label={t(item.labelKey)}
            icon={item.icon}
            isSelected={selectedSectionId === item.id}
            onSelect={onSelectSection}
          />
        ))}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={t("settings.title")}
      role="navigation"
      style={isDesktop ? sidebarStyles.desktopContainer : sidebarStyles.mobileContainer}
      testID="settings-sidebar"
    >
      {isDesktop ? (
        <ScrollView
          style={sidebarStyles.scrollBody}
          showsVerticalScrollIndicator={false}
          testID="settings-sidebar-scroll-body"
        >
          {sidebarBody}
        </ScrollView>
      ) : (
        sidebarBody
      )}
    </View>
  );
}

const sidebarStyles = StyleSheet.create((theme) => ({
  desktopContainer: {
    width: SETTINGS_DESKTOP_SIDEBAR_WIDTH,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  scrollBody: {
    flex: 1,
  },
  mobileContainer: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  list: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  itemSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  labelSelected: {
    color: theme.colors.foreground,
  },
}));
