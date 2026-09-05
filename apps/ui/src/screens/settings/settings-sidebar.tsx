import { useCallback, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Plus, Server } from "lucide-react-native";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { HostPicker as SharedHostPicker } from "@/components/hosts/host-picker";
import { HostStatusDot } from "@/components/host-status-dot";
import { useHosts } from "@/runtime/host-runtime";
import { orderHostsLocalFirst, type HostProfile } from "@/types/host-connection";
import { isElectronRuntime } from "@/desktop/host";
import { SETTINGS_DESKTOP_SIDEBAR_WIDTH } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import {
  type EnableBuiltInDaemonOption,
  useEnableBuiltInDaemonOption,
} from "@/desktop/hooks/use-enable-built-in-daemon-option";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import type { SettingsView } from "@/navigation/settings-navigation";
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

/**
 * Local daemon first, then remaining hosts in their existing order.
 */
export function useSortedHosts(hosts: HostProfile[], localServerId: string | null): HostProfile[] {
  return useMemo(() => orderHostsLocalFirst(hosts, localServerId), [hosts, localServerId]);
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
      onPress={handlePress}
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

interface HostPickerProps {
  activeServerId: string | null;
  sortedHosts: HostProfile[];
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  enableBuiltInDaemonOption: EnableBuiltInDaemonOption;
}

/**
 * Scopes the host sections to a host. Reuses the canonical sidebar host
 * switcher pattern (left-sidebar.tsx): a quiet row-styled trigger opening a
 * <Combobox>. The local host is listed first, each row shows the connection it
 * is using right now; an "Add host" row is always reachable from the list —
 * even with a single host.
 */
function HostPicker({
  activeServerId,
  sortedHosts,
  onSelectHost,
  onAddHost,
  enableBuiltInDaemonOption,
}: HostPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<View | null>(null);
  const activeHost =
    sortedHosts.find((host) => host.serverId === activeServerId) ?? sortedHosts[0] ?? null;

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const hostOptionTestID = useCallback(
    (serverId: string) => `settings-host-picker-item-${serverId}`,
    [],
  );
  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      sidebarStyles.pickerTrigger,
      hovered && sidebarStyles.pickerTriggerHovered,
    ],
    [],
  );

  return (
    <SharedHostPicker
      hosts={sortedHosts}
      value={activeServerId ?? ""}
      onSelect={onSelectHost}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      includeEnableBuiltInDaemon={enableBuiltInDaemonOption.visible}
      onEnableBuiltInDaemon={enableBuiltInDaemonOption.onPress}
      showActiveConnection
      searchable={false}
      title={t("settings.hostPicker.switchHost")}
      desktopMinWidth={240}
      addHostTestID="settings-add-host"
      hostOptionTestID={hostOptionTestID}
    >
      <ComboboxTrigger
        ref={triggerRef}
        block
        style={triggerStyle}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={t("settings.hostPicker.switchHost")}
        testID="settings-host-picker"
      >
        {activeHost ? (
          <View style={sidebarStyles.pickerTriggerDot}>
            <HostStatusDot serverId={activeHost.serverId} />
          </View>
        ) : null}
        <Text style={sidebarStyles.pickerTriggerLabel} numberOfLines={1}>
          {activeHost?.label ?? t("settings.groups.host")}
        </Text>
      </ComboboxTrigger>
    </SharedHostPicker>
  );
}

export interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  activeHostServerId: string | null;
  /** `desktop` is the scrolling nav column beside the detail pane; `mobile` is the root list. */
  layout: "desktop" | "mobile";
}

export function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHostSection,
  onSelectHost,
  onAddHost,
  activeHostServerId,
  layout,
}: SettingsSidebarProps) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const hasHosts = sortedHosts.length > 0;
  const enableBuiltInDaemonOption = useEnableBuiltInDaemonOption();
  const isDesktopApp = isElectronRuntime();
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const items = SIDEBAR_SECTION_ITEMS.filter(
    (item) =>
      (!item.desktopOnly || isDesktopApp) &&
      (!item.webOnly || isWeb) &&
      (!item.requiresKeyboardShortcuts || shortcutsAvailable),
  );
  const isDesktop = layout === "desktop";
  const selectedSectionId = view.kind === "section" ? view.section : null;
  let selectedHostSection: HostSectionSlug | null = null;
  if (view.kind === "host") selectedHostSection = view.section;
  if (view.kind === "project") selectedHostSection = "projects";

  const sidebarBody = (
    <>
      {hasHosts ? (
        <View style={sidebarStyles.list}>
          <Text style={sidebarStyles.groupLabel}>{t("settings.groups.host")}</Text>
          <HostPicker
            activeServerId={activeHostServerId}
            sortedHosts={sortedHosts}
            onSelectHost={onSelectHost}
            onAddHost={onAddHost}
            enableBuiltInDaemonOption={enableBuiltInDaemonOption}
          />
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
      ) : (
        <View style={sidebarStyles.list}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.addHost")}
            onPress={onAddHost}
            testID="settings-add-host"
            style={sidebarItemStyle}
          >
            <ThemedNavIcon Icon={Plus} uniProps={mutedColorMapping} />
            <Text style={sidebarStyles.label} numberOfLines={1}>
              {t("settings.addHost")}
            </Text>
          </Pressable>
          {enableBuiltInDaemonOption.visible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.enableBuiltInDaemon")}
              onPress={enableBuiltInDaemonOption.onPress}
              testID="settings-enable-built-in-daemon"
              style={sidebarItemStyle}
            >
              <ThemedNavIcon Icon={Server} uniProps={mutedColorMapping} />
              <Text style={sidebarStyles.label} numberOfLines={1}>
                {t("settings.enableBuiltInDaemon")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
      <View style={isDesktop ? sidebarStyles.appGroupDesktop : undefined}>
        <SidebarSeparator />
        <View style={sidebarStyles.list}>
          <Text style={sidebarStyles.groupLabel}>{t("settings.groups.app")}</Text>
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
      </View>
    </>
  );

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
          contentContainerStyle={sidebarStyles.scrollContent}
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
  // Lets the app group sit against the bottom of the nav column while the
  // host group stays anchored to the top.
  scrollContent: {
    flexGrow: 1,
  },
  mobileContainer: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  // Anchors the app group to the bottom of the nav column.
  appGroupDesktop: {
    marginTop: "auto",
  },
  list: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
  },
  groupLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
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
  pickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  pickerTriggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  pickerTriggerLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  // Match the setting items' icon footprint so the host label aligns with them.
  pickerTriggerDot: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
}));
