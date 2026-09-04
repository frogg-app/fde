import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Mic, Play, Square, Volume2, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { alertKey } from "@/spoken-alerts/state";
import { useSpokenAlertsStore } from "@/spoken-alerts/store";
import { useSpokenAlertPlayer } from "@/spoken-alerts/use-spoken-alert-player";
import { useWorkspaceVoiceAlertsEnabled } from "@/stores/workspace-voice-alerts-store";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";

interface SpokenAlertBannerProps {
  serverId: string;
  agentId: string;
  workspaceId?: string | null;
}

const ThemedVolumeIcon = withUnistyles(Volume2, (theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foregroundMuted,
}));

const ThemedCloseIcon = withUnistyles(X, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));

/**
 * Sits above the composer while the agent has a spoken alert: the alert text, a play/stop
 * control, and the way into a voice reply. Disappears on dismiss or when a message is sent.
 */
export function SpokenAlertBanner({ serverId, agentId, workspaceId }: SpokenAlertBannerProps) {
  const { t } = useTranslation();
  const voiceAlertsEnabled = useWorkspaceVoiceAlertsEnabled(serverId, workspaceId);
  const key = alertKey(serverId, agentId);
  const entry = useSpokenAlertsStore((state) => state.entries[key] ?? null);
  const dispatch = useSpokenAlertsStore((state) => state.dispatch);
  const openVoiceReply = useSpokenAlertsStore((state) => state.openVoiceReply);
  const client = useHostRuntimeClient(serverId);
  const player = useSpokenAlertPlayer(client);

  const handlePlayPress = useCallback(() => {
    if (!entry) return;
    if (entry.playback.status === "playing" || entry.playback.status === "loading") {
      player.stop(entry.alert);
      return;
    }
    void player.play(entry.alert);
  }, [entry, player]);

  const handleReplyPress = useCallback(() => {
    openVoiceReply({ serverId, agentId });
  }, [agentId, openVoiceReply, serverId]);

  const handleDismiss = useCallback(() => {
    if (entry) player.stop(entry.alert);
    dispatch({ type: "dismissed", key });
  }, [dispatch, entry, key, player]);

  if (!entry || !voiceAlertsEnabled) {
    return null;
  }

  const isBusy = entry.playback.status === "loading" || entry.playback.status === "playing";
  const playLabel = isBusy ? t("spokenAlerts.banner.stop") : t("spokenAlerts.banner.play");
  const failure = entry.playback.status === "failed" ? entry.playback.message : null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.container} testID="spoken-alert-banner">
        <View style={styles.header}>
          <ThemedVolumeIcon />
          <Text style={styles.text} numberOfLines={3}>
            {entry.alert.spokenText}
          </Text>
          <Pressable
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel={t("spokenAlerts.banner.dismiss")}
            hitSlop={8}
            style={styles.dismiss}
            testID="spoken-alert-dismiss"
          >
            <ThemedCloseIcon />
          </Pressable>
        </View>
        {failure ? <Text style={styles.failure}>{failure}</Text> : null}
        <View style={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            onPress={handlePlayPress}
            disabled={!player.canPlay}
            loading={entry.playback.status === "loading"}
            leftIcon={isBusy ? Square : Play}
            accessibilityLabel={playLabel}
            testID="spoken-alert-play"
          >
            {playLabel}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onPress={handleReplyPress}
            leftIcon={Mic}
            accessibilityLabel={t("spokenAlerts.banner.replyByVoice")}
            testID="spoken-alert-reply"
          >
            {t("spokenAlerts.banner.replyByVoice")}
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Matches the composer: the same outer gutter and content cap, so the banner lines up with
  // the chat column instead of spanning the whole pane.
  wrapper: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[2],
  },
  container: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  text: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  dismiss: {
    padding: theme.spacing[1],
  },
  failure: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
