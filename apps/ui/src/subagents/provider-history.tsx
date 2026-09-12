import { useCallback } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useSessionStore } from "@/stores/session-store";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";

export function useProviderSubagentHistory(input: {
  serverId: string;
  parentAgentId: string;
  subagentId: string;
  supported: boolean;
}) {
  const { serverId, parentAgentId, subagentId, supported } = input;
  const runtime = useHostRuntimeSnapshot(serverId);
  const connected = runtime?.connectionStatus === "online";
  const active = useRetainedPanelActive();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const query = useFetchQuery({
    queryKey: [
      "provider-subagent-history",
      serverId,
      runtime?.clientGeneration,
      runtime?.connectionEpoch,
      parentAgentId,
      subagentId,
    ],
    enabled: active && connected && supported && !!client,
    dataShape: "value",
    staleTimeMs: 0,
    queryFn: async () => {
      invariant(client, "Provider subagent history requires a client");
      await refreshProviderSubagents(client, serverId, parentAgentId);
      const payload = await client.fetchProviderSubagentTimeline(parentAgentId, subagentId, {
        direction: "tail",
        limit: TIMELINE_FETCH_PAGE_SIZE,
      });
      useProviderSubagentStore.getState().replaceTimeline(serverId, payload);
      return true;
    },
    retry: 1,
  });
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return { connected, pending: query.isPending, failed: query.isError, retry };
}

export function ProviderSubagentHistoryStatus({
  history,
  hasTimeline,
}: {
  history: ReturnType<typeof useProviderSubagentHistory>;
  hasTimeline: boolean;
}) {
  const { t } = useTranslation();
  if (!history.connected) return <Text style={styles.message}>{t("subagents.offline")}</Text>;
  if (history.failed)
    return (
      <Button variant="ghost" size="sm" onPress={history.retry}>
        {t("subagents.activityFailedRetry")}
      </Button>
    );
  if (history.pending && !hasTimeline)
    return <Text style={styles.message}>{t("common.states.loading")}</Text>;
  return null;
}

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[2],
  },
}));
