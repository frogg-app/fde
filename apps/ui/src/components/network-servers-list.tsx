import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RefreshCw } from "lucide-react-native";
import type { HostProfile } from "@/types/host-connection";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { useNetworkScan } from "@/network-scan/use-network-scan";
import type { DiscoveredServer } from "@/network-scan/types";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatConnectionFailureMessage } from "./add-host-connection-errors";
import { useDirectConnectionErrorLabels } from "./use-direct-connection-error-labels";
import type { Theme } from "@/styles/theme";

const ThemedSpinner = withUnistyles(LoadingSpinner);
const mutedSpinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface NetworkServerConnectedResult {
  profile: HostProfile;
  serverId: string;
  hostname: string | null;
  isNewHost: boolean;
}

export interface NetworkServersListProps {
  onConnected: (result: NetworkServerConnectedResult) => void;
  testID?: string;
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    flexShrink: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[1],
  },
  rowError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[1],
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  badge: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  badgeText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));

function describeServer(server: DiscoveredServer): { title: string; subtext: string } {
  const details = [server.endpoint];
  if (server.version) details.push(`v${server.version}`);
  return {
    title: server.hostname ?? server.endpoint,
    subtext: details.join(" · "),
  };
}

function NetworkServerRow({
  server,
  onConnected,
}: {
  server: DiscoveredServer;
  onConnected: (result: NetworkServerConnectedResult) => void;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { probeAndUpsertDirectConnection } = useHostMutations();
  const labels = useDirectConnectionErrorLabels();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { title, subtext } = describeServer(server);

  const handleConnect = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      const result = await probeAndUpsertDirectConnection({
        endpoint: server.endpoint,
        useTls: false,
      });
      const isNewHost = !hosts.some((host) => host.serverId === result.serverId);
      onConnected({ ...result, isNewHost });
    } catch (connectError) {
      setError(
        formatConnectionFailureMessage({
          endpoint: server.endpoint,
          error: connectError,
          labels,
          detailsLabel: (detail) => t("pairing.direct.errors.details", { detail }),
        }),
      );
    } finally {
      setIsConnecting(false);
    }
  }, [
    hosts,
    isConnecting,
    labels,
    onConnected,
    probeAndUpsertDirectConnection,
    server.endpoint,
    t,
  ]);

  const handlePress = useCallback(() => {
    void handleConnect();
  }, [handleConnect]);

  // An unclaimed daemon refuses LAN clients until one redeems a pairing link,
  // so a bare Connect would only fail with 401: point at the link instead.
  if (server.pairingRequired) {
    return (
      <View style={styles.row} testID={`network-server-${server.endpoint}`}>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowSubtext} numberOfLines={1}>
            {subtext}
          </Text>
          <Text style={styles.rowHint} testID={`network-server-${server.endpoint}-pairing-hint`}>
            {t("pairing.networkScan.pairingHint")}
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t("pairing.networkScan.needsPairing")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row} testID={`network-server-${server.endpoint}`}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSubtext} numberOfLines={1}>
          {subtext}
        </Text>
        {error ? <Text style={styles.rowError}>{error}</Text> : null}
      </View>
      <Button variant="secondary" size="sm" onPress={handlePress} loading={isConnecting}>
        {isConnecting ? t("pairing.networkScan.connecting") : t("pairing.networkScan.connect")}
      </Button>
    </View>
  );
}

/** "Servers on your network": FDE daemons found by sweeping the local subnets. */
export function NetworkServersList({ onConnected, testID }: NetworkServersListProps) {
  const { t } = useTranslation();
  const scan = useNetworkScan();
  const scannedSubnets = useMemo(
    () => scan.subnets.map((prefix) => `${prefix}.0/24`).join(", "),
    [scan.subnets],
  );

  return (
    <View style={styles.section} testID={testID ?? "network-servers"}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("pairing.networkScan.title")}</Text>
        {scan.status === "done" ? (
          <Button variant="ghost" size="sm" leftIcon={RefreshCw} onPress={scan.rescan}>
            {t("pairing.networkScan.rescan")}
          </Button>
        ) : null}
      </View>
      {scan.status === "scanning" ? (
        <View style={styles.statusRow}>
          <ThemedSpinner uniProps={mutedSpinnerMapping} />
          <Text style={styles.statusText}>
            {t("pairing.networkScan.scanning", {
              scanned: scan.progress.scanned,
              total: scan.progress.total,
            })}
          </Text>
        </View>
      ) : null}
      {scan.status === "done" && scan.servers.length === 0 ? (
        <Text style={styles.statusText}>
          {t("pairing.networkScan.none", { subnets: scannedSubnets })}
        </Text>
      ) : null}
      {scan.servers.map((server) => (
        <NetworkServerRow key={server.endpoint} server={server} onConnected={onConnected} />
      ))}
      {scan.status === "done" && scan.servers.length > 0 ? (
        <Text style={styles.statusText}>
          {t("pairing.networkScan.scanned", { subnets: scannedSubnets })}
        </Text>
      ) : null}
    </View>
  );
}
