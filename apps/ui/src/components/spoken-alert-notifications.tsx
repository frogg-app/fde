import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { router } from "expo-router";
import { useShallow } from "zustand/shallow";
import { Play, Square, Volume2, X } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { selectSpokenAlertNotificationKeys } from "@/spoken-alerts/state";
import { useSpokenAlertsStore } from "@/spoken-alerts/store";
import { useSpokenAlertPlayer } from "@/spoken-alerts/use-spoken-alert-player";
import { useSessionStore } from "@/stores/session-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

// Enough to see what is waiting without walling off the corner of the app.
const MAX_VISIBLE_NOTIFICATIONS = 3;

const ThemedAlertIcon = withUnistyles(Volume2, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));

const ThemedDismissIcon = withUnistyles(X, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));

const ThemedPlayIcon = withUnistyles(Play, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foreground,
}));

const ThemedStopIcon = withUnistyles(Square, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foreground,
}));

/**
 * Corner cards for spoken alerts that landed while the user was looking somewhere else. They
 * say which agent wants attention rather than repeating what it said, and they stay until the
 * user acts: opening the card goes to that agent's tab, and dismissing clears it.
 */
export function SpokenAlertNotifications() {
  const keys = useSpokenAlertsStore(useShallow(selectSpokenAlertNotificationKeys));
  const insets = useSafeAreaInsets();
  const visibleKeys = useMemo(() => keys.slice(-MAX_VISIBLE_NOTIFICATIONS), [keys]);
  const containerStyle = useMemo(
    () => [styles.container, { paddingBottom: insets.bottom + 16 }],
    [insets.bottom],
  );

  if (visibleKeys.length === 0) {
    return null;
  }

  const content = (
    <View style={containerStyle} pointerEvents="box-none" testID="spoken-alert-notifications">
      {visibleKeys.map((key) => (
        <SpokenAlertNotificationCard key={key} alertKey={key} />
      ))}
    </View>
  );

  if (isWeb && typeof document !== "undefined") {
    return createPortal(content, getOverlayRoot());
  }
  return content;
}

function SpokenAlertNotificationCard({ alertKey }: { alertKey: string }) {
  const { t } = useTranslation();
  const entry = useSpokenAlertsStore((state) => state.entries[alertKey] ?? null);
  const dispatch = useSpokenAlertsStore((state) => state.dispatch);
  const serverId = entry?.alert.serverId ?? "";
  const agentId = entry?.alert.agentId ?? "";
  const client = useHostRuntimeClient(serverId);
  const player = useSpokenAlertPlayer(client);
  const agentLabel = useAgentLabel(serverId, agentId);

  const handleDismiss = useCallback(() => {
    if (entry) player.stop(entry.alert);
    dispatch({ type: "notification_dismissed", key: alertKey });
  }, [alertKey, dispatch, entry, player]);

  const handlePlay = useCallback(() => {
    if (!entry) return;
    if (entry.playback.status === "playing" || entry.playback.status === "loading") {
      player.stop(entry.alert);
      return;
    }
    void player.play(entry.alert);
  }, [entry, player]);

  const handleOpen = useCallback(() => {
    if (!entry) return;
    dispatch({ type: "notification_dismissed", key: alertKey });
    router.push(buildHostAgentDetailRoute(serverId, agentId, entry.alert.workspaceId ?? undefined));
  }, [agentId, alertKey, dispatch, entry, serverId]);

  if (!entry) {
    return null;
  }

  const isBusy = entry.playback.status === "loading" || entry.playback.status === "playing";
  const title = agentLabel
    ? t("spokenAlerts.notification.title", { name: agentLabel })
    : t("spokenAlerts.notification.titleFallback");

  return (
    <Pressable
      onPress={handleOpen}
      accessibilityRole="button"
      accessibilityLabel={t("spokenAlerts.notification.open", { name: title })}
      style={styles.card}
      testID="spoken-alert-notification"
    >
      <ThemedAlertIcon />
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        onPress={handlePlay}
        disabled={!player.canPlay}
        accessibilityRole="button"
        accessibilityLabel={
          isBusy ? t("spokenAlerts.notification.stop") : t("spokenAlerts.notification.play")
        }
        hitSlop={6}
        style={styles.action}
        testID="spoken-alert-notification-play"
      >
        {isBusy ? <ThemedStopIcon /> : <ThemedPlayIcon />}
      </Pressable>
      <Pressable
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("spokenAlerts.notification.dismiss")}
        hitSlop={6}
        style={styles.action}
        testID="spoken-alert-notification-dismiss"
      >
        <ThemedDismissIcon />
      </Pressable>
    </Pressable>
  );
}

/** The agent's own title, falling back to the workspace it belongs to. */
function useAgentLabel(serverId: string, agentId: string): string | null {
  return useSessionStore((state) => {
    const session = state.sessions[serverId];
    if (!session) return null;
    const agent = session.agents?.get(agentId) ?? session.agentDetails?.get(agentId) ?? null;
    const title = agent?.title?.trim();
    if (title) return title;
    const workspaceId = agent?.workspaceId;
    const workspace = workspaceId ? session.workspaces.get(workspaceId) : null;
    return workspace?.title?.trim() || workspace?.name?.trim() || null;
  });
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    right: theme.spacing[4],
    bottom: 0,
    gap: theme.spacing[2],
    alignItems: "flex-end",
    zIndex: OVERLAY_Z.toast,
  },
  card: {
    maxWidth: 320,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.md,
  },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  action: {
    padding: theme.spacing[1],
  },
}));
