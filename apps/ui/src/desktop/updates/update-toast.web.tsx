import { createPortal } from "react-dom";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { SidebarCallout, type SidebarCalloutProps } from "@/components/sidebar-callout";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { useDownloadStore } from "@/stores/download-store";

/** Desktop-only notification; ordinary app toasts keep their existing placement. */
export function UpdateToast(props: SidebarCalloutProps) {
  const insets = useSafeAreaInsets();
  const activeDownloadId = useDownloadStore((state) => state.activeDownloadId);
  // File downloads own the bottom edge until dismissed. Defer this notification
  // rather than covering a download's progress or dismiss control.
  if (activeDownloadId || typeof document === "undefined") return null;
  return createPortal(
    <View style={[styles.viewport, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
      <View style={styles.card} pointerEvents="auto">
        <SidebarCallout {...props} testID="desktop-update-toast" />
      </View>
    </View>,
    getOverlayRoot(),
  );
}

const styles = StyleSheet.create((theme) => ({
  viewport: {
    position: "absolute",
    right: theme.spacing[4],
    left: theme.spacing[4],
    bottom: theme.spacing[4],
    alignItems: "flex-end",
    zIndex: OVERLAY_Z.toast,
  },
  card: {
    width: 360,
    maxWidth: "100%",
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    ...theme.shadow.md,
  },
}));
