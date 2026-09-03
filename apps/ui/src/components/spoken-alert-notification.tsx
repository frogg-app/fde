import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, PanResponder, Pressable, Text, View } from "react-native";
import { createPortal } from "react-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Play, Volume2 } from "lucide-react-native";
import { AudioWaveIcon } from "@/components/audio-wave-icon";
import { isWeb } from "@/constants/platform";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { OVERLAY_Z, getOverlayRoot } from "@/lib/overlay-root";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { SpokenAlertEntry } from "@/spoken-alerts/state";
import { alertKey } from "@/spoken-alerts/state";
import { selectBusySpokenAlertEntry, useSpokenAlertsStore } from "@/spoken-alerts/store";
import { useSpokenAlertPlayer } from "@/spoken-alerts/use-spoken-alert-player";
import { SPACING } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const ThemedPlayIcon = withUnistyles(Play, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foreground,
}));

const ThemedAlertIcon = withUnistyles(Volume2, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));

// Long enough to read the headline and reach the play control.
const NOTIFICATION_VISIBLE_MS = 8000;
const SWIPE_DISMISS_DISTANCE = 64;
const SWIPE_EXIT_DISTANCE = 400;
const ICON_WAVE_SIZE = 14;

function isBusy(entry: SpokenAlertEntry): boolean {
  return entry.playback.status === "playing" || entry.playback.status === "loading";
}

/**
 * The play control that lives on the notification and, once the card is gone, in the corner.
 * It is a play button until the alert is playing, then an audio wave that stops playback.
 */
function AlertPlaybackButton({
  entry,
  style,
  testID,
}: {
  entry: SpokenAlertEntry;
  style?: React.ComponentProps<typeof Pressable>["style"];
  testID: string;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(entry.alert.serverId);
  const player = useSpokenAlertPlayer(client);
  const busy = isBusy(entry);

  const handlePress = useCallback(() => {
    if (busy) {
      player.stop(entry.alert);
      return;
    }
    void player.play(entry.alert);
  }, [busy, entry.alert, player]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={!player.canPlay}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        busy ? t("spokenAlerts.notification.stop") : t("spokenAlerts.notification.play")
      }
      style={style ?? styles.playButton}
      testID={testID}
    >
      {busy ? (
        <AudioWaveIcon size={ICON_WAVE_SIZE} testID={`${testID}-wave`} />
      ) : (
        <ThemedPlayIcon />
      )}
    </Pressable>
  );
}

/** The card itself: tap to open the workspace, swipe sideways to send it away. */
function SpokenAlertNotificationCard({ entry }: { entry: SpokenAlertEntry }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompact = useIsCompactFormFactor();
  const dismissNotification = useSpokenAlertsStore((state) => state.dismissNotification);
  const key = alertKey(entry.alert.serverId, entry.alert.agentId);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const translateX = useRef(new Animated.Value(0)).current;

  const dismiss = useCallback(() => {
    dismissNotification(key);
  }, [dismissNotification, key]);

  const slideOut = useCallback(
    (direction: number) => {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: direction * SWIPE_EXIT_DISTANCE,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(dismiss);
    },
    [dismiss, opacity, translateX],
  );

  useEffect(() => {
    opacity.setValue(0);
    translateX.setValue(0);
    translateY.setValue(-12);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    const timeout = setTimeout(dismiss, NOTIFICATION_VISIBLE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [dismiss, entry.alert.id, opacity, translateX, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          translateX.setValue(gesture.dx);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) > SWIPE_DISMISS_DISTANCE) {
            slideOut(Math.sign(gesture.dx) || 1);
            return;
          }
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
      }),
    [slideOut, translateX],
  );

  const handleOpen = useCallback(() => {
    navigateToAgent({
      serverId: entry.alert.serverId,
      agentId: entry.alert.agentId,
      workspaceId: entry.alert.workspaceId,
      pin: true,
    });
    dismiss();
  }, [dismiss, entry.alert.agentId, entry.alert.serverId, entry.alert.workspaceId]);

  const headerHeight = isCompact ? HEADER_INNER_HEIGHT_MOBILE : HEADER_INNER_HEIGHT;
  const headerTopPadding = isCompact ? HEADER_TOP_PADDING_MOBILE : 0;
  const cardStyle = useMemo(
    () => [
      styles.card,
      {
        marginTop: insets.top + headerTopPadding + headerHeight + SPACING[2],
        opacity,
        transform: [{ translateY }, { translateX }],
      },
    ],
    [headerHeight, headerTopPadding, insets.top, opacity, translateX, translateY],
  );

  const title = entry.alert.title ?? entry.alert.spokenText;

  return (
    <Animated.View
      style={cardStyle}
      accessibilityRole="alert"
      testID="spoken-alert-notification"
      {...panResponder.panHandlers}
    >
      <Pressable
        style={styles.body}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={t("spokenAlerts.notification.open")}
        testID="spoken-alert-notification-open"
      >
        <ThemedAlertIcon />
        <View style={styles.textColumn}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {entry.alert.title ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {entry.alert.spokenText}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <AlertPlaybackButton entry={entry} testID="spoken-alert-notification-play" />
    </Animated.View>
  );
}

/** Where the wave lands once the card that hosted it is dismissed mid-playback. */
function FloatingPlaybackButton({ entry }: { entry: SpokenAlertEntry }) {
  const insets = useSafeAreaInsets();
  const isCompact = useIsCompactFormFactor();
  const headerHeight = isCompact ? HEADER_INNER_HEIGHT_MOBILE : HEADER_INNER_HEIGHT;
  const headerTopPadding = isCompact ? HEADER_TOP_PADDING_MOBILE : 0;
  const style = useMemo(
    () => [
      styles.floatingButton,
      { marginTop: insets.top + headerTopPadding + headerHeight + SPACING[2] },
    ],
    [headerHeight, headerTopPadding, insets.top],
  );

  return (
    <View style={styles.floatingRow} pointerEvents="box-none">
      <AlertPlaybackButton entry={entry} style={style} testID="spoken-alert-floating-play" />
    </View>
  );
}

/**
 * Every spoken alert surfaces here first: a card at the top of the app that opens the
 * workspace when tapped and plays the reply when its button is. Nothing plays on its own.
 */
export function SpokenAlertNotificationHost() {
  const notificationKey = useSpokenAlertsStore((state) => state.notificationKey);
  const entry = useSpokenAlertsStore((state) =>
    notificationKey ? (state.entries[notificationKey] ?? null) : null,
  );
  const busyEntry = useSpokenAlertsStore(selectBusySpokenAlertEntry);

  if (!entry && !busyEntry) {
    return null;
  }

  const content = (
    <View style={styles.container} pointerEvents="box-none">
      {entry ? <SpokenAlertNotificationCard entry={entry} /> : null}
      {busyEntry && busyEntry !== entry ? <FloatingPlaybackButton entry={busyEntry} /> : null}
    </View>
  );

  if (isWeb && typeof document !== "undefined") {
    return createPortal(content, getOverlayRoot());
  }
  return content;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: theme.spacing[4],
    right: theme.spacing[4],
    top: 0,
    zIndex: OVERLAY_Z.toast,
    alignItems: "center",
  },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    ...theme.shadow.md,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  playButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  floatingRow: {
    width: "100%",
    alignItems: "flex-end",
  },
  floatingButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.md,
  },
}));
