import { useEffect, useMemo } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SETTINGS_DESKTOP_SPLIT_MIN_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { buildSettingsViewRoute } from "@/navigation/settings-navigation";
import SettingsScreen from "@/screens/settings-screen";
import { useSettingsModalStore } from "@/settings-modal/store";
import { WindowChromeRegion } from "@/utils/desktop-window";

const SETTINGS_MODAL_MAX_WIDTH = 1100;
const SETTINGS_MODAL_MAX_HEIGHT = 760;

/**
 * Mounts once in the app container. On wide layouts it presents the settings
 * split view (nav column + detail pane) as a centred modal; on compact
 * layouts the full-screen `/settings` routes own settings, so an open view
 * is handed to the router instead.
 */
export function SettingsModalHost() {
  const { t } = useTranslation();
  const view = useSettingsModalStore((state) => state.view);
  const openAddHostIntent = useSettingsModalStore((state) => state.openAddHostIntent);
  const close = useSettingsModalStore((state) => state.close);
  const isCompactLayout = useIsCompactFormFactor();
  const header = useMemo<SheetHeader>(() => ({ title: t("settings.title") }), [t]);

  useEffect(() => {
    if (!isCompactLayout || view === null) return;
    close();
    router.push(buildSettingsViewRoute(view));
  }, [close, isCompactLayout, view]);

  if (isCompactLayout) {
    return null;
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={view !== null}
      onClose={close}
      scrollable={false}
      contentStyle={styles.content}
      desktopCardStyle={styles.card}
      closeButtonTestID="settings-back-to-workspace"
      testID="settings-modal"
    >
      {view ? (
        // The modal floats clear of the window controls, so the section
        // header inside it must not reserve clearance for them.
        <WindowChromeRegion corners="none">
          <SettingsScreen view={view} openAddHostIntent={openAddHostIntent} />
        </WindowChromeRegion>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "80%",
    minWidth: SETTINGS_DESKTOP_SPLIT_MIN_WIDTH,
    maxWidth: SETTINGS_MODAL_MAX_WIDTH,
    height: "80%",
    maxHeight: SETTINGS_MODAL_MAX_HEIGHT,
    overflow: "hidden",
  },
  // The split view owns its own rails; the sheet's content inset would double them.
  content: {
    flex: 1,
    padding: 0,
    gap: 0,
  },
});
