import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ClipboardPaste, Link2, QrCode, Server, Terminal } from "lucide-react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuSurface } from "@/components/ui/menu";
import {
  isRemoteSshAddHostAvailable,
  isScanQrAddHostAvailable,
} from "@/components/add-host-method-modal";
import { HostStatusDot } from "@/components/host-status-dot";
import { formatActiveConnectionLabel } from "@/components/hosts/host-picker";
import { useEnableBuiltInDaemonOption } from "@/desktop/hooks/use-enable-built-in-daemon-option";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { openAddHostFlow, openPairScan } from "@/hosts/add-host-flow";
import { openHostSettings } from "@/navigation/settings-navigation";
import { useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import { orderHostsLocalFirst } from "@/types/host-connection";
import type { Theme } from "@/styles/theme";

const MENU_WIDTH = 260;
const ICON_SIZE = 14;

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLink2 = withUnistyles(Link2);
const ThemedTerminal = withUnistyles(Terminal);
const ThemedClipboardPaste = withUnistyles(ClipboardPaste);
const ThemedQrCode = withUnistyles(QrCode);
const ThemedServer = withUnistyles(Server);

const DIRECT_ICON = <ThemedLink2 size={ICON_SIZE} uniProps={mutedIconMapping} />;
const REMOTE_SSH_ICON = <ThemedTerminal size={ICON_SIZE} uniProps={mutedIconMapping} />;
const PASTE_LINK_ICON = <ThemedClipboardPaste size={ICON_SIZE} uniProps={mutedIconMapping} />;
const SCAN_QR_ICON = <ThemedQrCode size={ICON_SIZE} uniProps={mutedIconMapping} />;
const SERVER_ICON = <ThemedServer size={ICON_SIZE} uniProps={mutedIconMapping} />;

interface HostsMenuProps {
  /** Runs before any menu action leaves the sidebar, e.g. to close the mobile sidebar panel. */
  onBeforeAction?: () => void;
}

/**
 * The sidebar footer's Hosts entry: ways to add a host, then the hosts you
 * have, local first. Picking a host opens that host's settings. A popover on
 * wide layouts and a bottom sheet on compact ones (docs/menus.md).
 */
export function HostsMenu({ onBeforeAction }: HostsMenuProps): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const orderedHosts = useMemo(
    () => orderHostsLocalFirst(hosts, localServerId),
    [hosts, localServerId],
  );
  const enableBuiltInDaemonOption = useEnableBuiltInDaemonOption();
  const addHostKeys = useShortcutKeys("add-host");

  const runAction = useCallback(
    (action: () => void) => () => {
      onBeforeAction?.();
      action();
    },
    [onBeforeAction],
  );
  const handleDirect = useMemo(() => runAction(() => openAddHostFlow("direct")), [runAction]);
  const handleRemoteSsh = useMemo(
    () => runAction(() => openAddHostFlow("remote-ssh")),
    [runAction],
  );
  const handlePasteLink = useMemo(() => runAction(() => openAddHostFlow("pair-link")), [runAction]);
  const handleScanQr = useMemo(() => runAction(openPairScan), [runAction]);
  const handleEnableBuiltInDaemon = useMemo(
    () => runAction(enableBuiltInDaemonOption.onPress),
    [enableBuiltInDaemonOption.onPress, runAction],
  );
  const handleOpenHost = useCallback(
    (serverId: string) => {
      onBeforeAction?.();
      openHostSettings(serverId);
    },
    [onBeforeAction],
  );

  return (
    <MenuRoot compactMode="sheet">
      <SidebarHeaderRow
        menuTrigger
        icon={Server}
        label={t("sidebar.hostsMenu.trigger")}
        shortcutKeys={addHostKeys}
        testID="sidebar-hosts"
        nativeID="sidebar-hosts"
        variant="compact"
      />
      <MenuSurface
        side="top"
        align="start"
        width={MENU_WIDTH}
        sheetTitle={t("sidebar.hostsMenu.trigger")}
        testID="sidebar-hosts-menu"
      >
        <MenuLabel>{t("sidebar.hostsMenu.addHost")}</MenuLabel>
        <MenuItem leading={DIRECT_ICON} onSelect={handleDirect} testID="sidebar-hosts-add-direct">
          {t("pairing.connectionMethods.direct.title")}
        </MenuItem>
        {isRemoteSshAddHostAvailable() ? (
          <MenuItem
            leading={REMOTE_SSH_ICON}
            onSelect={handleRemoteSsh}
            testID="sidebar-hosts-add-remote-ssh"
          >
            {t("pairing.connectionMethods.remoteSsh.title")}
          </MenuItem>
        ) : null}
        <MenuItem
          leading={PASTE_LINK_ICON}
          onSelect={handlePasteLink}
          testID="sidebar-hosts-add-pair-link"
        >
          {t("pairing.connectionMethods.pasteLink.title")}
        </MenuItem>
        {isScanQrAddHostAvailable() ? (
          <MenuItem leading={SCAN_QR_ICON} onSelect={handleScanQr} testID="sidebar-hosts-scan-qr">
            {t("pairing.connectionMethods.scanQr.title")}
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuLabel>{t("sidebar.hostsMenu.hosts")}</MenuLabel>
        {enableBuiltInDaemonOption.visible ? (
          <MenuItem
            leading={SERVER_ICON}
            onSelect={handleEnableBuiltInDaemon}
            testID="sidebar-hosts-enable-built-in-daemon"
          >
            {t("settings.enableBuiltInDaemon")}
          </MenuItem>
        ) : null}
        {orderedHosts.length === 0 && !enableBuiltInDaemonOption.visible ? (
          <MenuItem muted disabled testID="sidebar-hosts-empty">
            {t("sidebar.hostsMenu.noHosts")}
          </MenuItem>
        ) : null}
        {orderedHosts.map((host) => (
          <HostsMenuHostItem
            key={host.serverId}
            serverId={host.serverId}
            label={host.label?.trim() || host.serverId}
            onOpen={handleOpenHost}
          />
        ))}
      </MenuSurface>
    </MenuRoot>
  );
}

function HostsMenuHostItem({
  serverId,
  label,
  onOpen,
}: {
  serverId: string;
  label: string;
  onOpen: (serverId: string) => void;
}): ReactElement {
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const leading = useMemo(
    () => (
      <View style={styles.dotSlot}>
        <HostStatusDot serverId={serverId} />
      </View>
    ),
    [serverId],
  );
  const handleSelect = useCallback(() => onOpen(serverId), [onOpen, serverId]);
  return (
    <MenuItem
      leading={leading}
      description={activeConnection ? formatActiveConnectionLabel(activeConnection) : undefined}
      onSelect={handleSelect}
      testID={`sidebar-hosts-item-${serverId}`}
    >
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create({
  dotSlot: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
