import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert as RNAlert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import {
  describeConnectionEndpoint,
  findDaemonConflictGroups,
  type DaemonConflictGroup,
} from "./daemon-conflicts";
import { useDaemonVersions } from "./use-daemon-versions";

/**
 * Warns when one machine is running more than one daemon.
 *
 * Easy to create by accident and confusing to diagnose: each daemon has its own
 * agents and workspaces, so work appears to vanish depending on which host is
 * selected. We surface it, show versions so a stale one is identifiable, and
 * offer to shut the other down - never automatically, since a second daemon is
 * sometimes deliberate.
 */
export function DaemonConflictWarning({ serverId }: { serverId: string }) {
  const hosts = useHosts();
  const group = useMemo(
    () =>
      findDaemonConflictGroups(hosts).find((candidate) =>
        candidate.profiles.some((profile) => profile.serverId === serverId),
      ),
    [hosts, serverId],
  );

  if (!group) return null;
  return <ConflictCard group={group} activeServerId={serverId} />;
}

function ConflictCard({
  group,
  activeServerId,
}: {
  group: DaemonConflictGroup;
  activeServerId: string;
}) {
  const { t } = useTranslation();
  const versions = useDaemonVersions(group.profiles);

  return (
    <View style={styles.wrapper}>
      <Alert
        variant="warning"
        title={t("settings.host.daemonConflict.title")}
        description={t("settings.host.daemonConflict.message", {
          machine: group.machine,
          count: group.profiles.length,
        })}
        testID="daemon-conflict-alert"
      >
        <View style={styles.rows}>
          {group.profiles.map((profile) => (
            <DaemonRow
              key={profile.serverId}
              profile={profile}
              version={versions.get(profile.serverId) ?? null}
              isActive={profile.serverId === activeServerId}
            />
          ))}
        </View>
      </Alert>
    </View>
  );
}

function DaemonRow({
  profile,
  version,
  isActive,
}: {
  profile: HostProfile;
  version: string | null;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(profile.serverId);
  const [isShuttingDown, setIsShuttingDown] = useState(false);

  const endpoint = useMemo(() => {
    const preferred =
      profile.connections.find((connection) => connection.id === profile.preferredConnectionId) ??
      profile.connections[0];
    return preferred ? describeConnectionEndpoint(preferred) : profile.serverId;
  }, [profile]);

  const handleShutdown = useCallback(() => {
    if (!client) return;
    RNAlert.alert(
      t("settings.host.daemonConflict.shutdownTitle"),
      t("settings.host.daemonConflict.shutdownMessage", { name: profile.label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.host.daemonConflict.shutdownConfirm"),
          style: "destructive",
          onPress: () => {
            setIsShuttingDown(true);
            void client
              .shutdownServer()
              .catch((error: unknown) => {
                console.error("[DaemonConflict] Failed to shut down daemon", error);
                RNAlert.alert(
                  t("settings.host.daemonConflict.shutdownFailedTitle"),
                  t("settings.host.daemonConflict.shutdownFailedMessage"),
                );
              })
              .finally(() => setIsShuttingDown(false));
          },
        },
      ],
    );
  }, [client, profile.label, t]);

  return (
    <View style={styles.row} testID={`daemon-conflict-row-${profile.serverId}`}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {isActive
            ? t("settings.host.daemonConflict.activeLabel", { name: profile.label })
            : profile.label}
        </Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {endpoint}
          {" · "}
          {version
            ? t("settings.host.daemonConflict.version", { version })
            : t("settings.host.daemonConflict.versionUnknown")}
        </Text>
      </View>
      <Button
        variant="ghost"
        size="sm"
        onPress={handleShutdown}
        disabled={!client || isShuttingDown}
        testID={`daemon-conflict-shutdown-${profile.serverId}`}
      >
        {t("settings.host.daemonConflict.shutdown")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrapper: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  rows: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowText: {
    flexShrink: 1,
  },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  rowDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
