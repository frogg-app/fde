import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Animated, Easing, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import {
  formatOfflineDuration,
  reconcileConnectionNotices,
  type ConnectionNotice,
  type ConnectionNoticeHostInput,
} from "./connection-notice-model";

const TICK_MS = 1_000;

/**
 * Wide-layout daemon connection feedback: a card in the bottom-right corner per host that dropped
 * after being online, ticking the offline duration, then a brief "Reconnected" confirmation.
 * Compact layouts keep the agent panel's top toast.
 */
export function ConnectionNoticeHost() {
  const isCompact = useIsCompactFormFactor();
  if (isCompact || !isWeb || typeof document === "undefined") {
    return null;
  }
  return <ConnectionNoticeStack />;
}

function ConnectionNoticeStack() {
  const hosts = useHosts();
  const store = getHostRuntimeStore();
  const version = useSyncExternalStore(
    (onStoreChange) => store.subscribeAll(onStoreChange),
    () => store.getVersion(),
    () => store.getVersion(),
  );
  const [now, setNow] = useState(() => Date.now());
  const noticesRef = useRef<ConnectionNotice[]>([]);
  const seenOnlineRef = useRef(new Set<string>());

  const inputs = useMemo<ConnectionNoticeHostInput[]>(() => {
    void version;
    return hosts.map((host) => ({
      serverId: host.serverId,
      label: host.label,
      status: store.getSnapshot(host.serverId)?.connectionStatus ?? "connecting",
      statusSince: store.getConnectionStatusSince(host.serverId),
    }));
  }, [hosts, store, version]);

  const notices = reconcileConnectionNotices({
    previous: noticesRef.current,
    hosts: inputs,
    seenOnline: seenOnlineRef.current,
    now,
  });
  noticesRef.current = notices;

  const hasNotices = notices.length > 0 || inputs.some((input) => input.status !== "online");
  useEffect(() => {
    if (!hasNotices) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [hasNotices]);

  const visible = notices.filter((notice) => now >= notice.showAt);
  if (visible.length === 0) {
    return null;
  }

  return createPortal(
    <View style={styles.stack} pointerEvents="box-none" testID="connection-notice-stack">
      {visible.map((notice) => (
        <ConnectionNoticeCard key={notice.serverId} notice={notice} now={now} />
      ))}
    </View>,
    getOverlayRoot(),
  );
}

function ConnectionNoticeCard({ notice, now }: { notice: ConnectionNotice; now: number }) {
  const { t } = useTranslation();
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const isOffline = notice.kind === "offline";

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  useEffect(() => {
    if (!isOffline) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isOffline, pulse]);

  const cardStyle = useMemo(
    () => [
      styles.card,
      isOffline ? styles.cardOffline : styles.cardOnline,
      {
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
        ],
      },
    ],
    [enter, isOffline],
  );
  const dotStyle = useMemo(
    () => [styles.dot, isOffline ? styles.dotOffline : styles.dotOnline, { opacity: pulse }],
    [isOffline, pulse],
  );

  return (
    <Animated.View
      style={cardStyle}
      accessibilityRole="alert"
      testID={isOffline ? "connection-notice-offline" : "connection-notice-reconnected"}
    >
      <View style={styles.iconSlot}>
        <Animated.View style={dotStyle} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {isOffline
            ? t("agentPanel.connectionNotice.lost", { serverLabel: notice.label })
            : t("agentPanel.connectionNotice.reconnected", { serverLabel: notice.label })}
        </Text>
        {isOffline ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {t("agentPanel.connectionNotice.reconnecting", {
              duration: formatOfflineDuration(now - notice.since),
            })}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    position: "absolute",
    right: theme.spacing[4],
    bottom: theme.spacing[4],
    zIndex: OVERLAY_Z.toast,
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minWidth: 260,
    maxWidth: 380,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.md,
  },
  cardOffline: {
    borderColor: theme.colors.destructive,
  },
  cardOnline: {
    borderColor: theme.colors.palette.green[600],
  },
  iconSlot: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: theme.borderRadius.full,
  },
  dotOffline: {
    backgroundColor: theme.colors.destructive,
  },
  dotOnline: {
    backgroundColor: theme.colors.palette.green[500],
  },
  body: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
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
}));
