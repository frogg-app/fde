import { useEffect } from "react";
import { router } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import { leaveSettings, type SettingsView } from "@/navigation/settings-navigation";
import SettingsScreen from "@/screens/settings-screen";
import { useSettingsModalStore } from "@/settings-modal/store";

interface SettingsRouteEntryProps {
  view: SettingsView;
  openAddHostIntent?: string | null;
}

/**
 * What every `/settings` route renders. Compact layouts get the full-screen
 * settings screen. Wide layouts open the settings modal on the routed view
 * and step back off the route, so deep links and `router.push("/settings/…")`
 * callers keep working without knowing which presentation is in use.
 */
export function SettingsRouteEntry({ view, openAddHostIntent = null }: SettingsRouteEntryProps) {
  const isCompactLayout = useIsCompactFormFactor();
  const openModal = useSettingsModalStore((state) => state.open);

  useEffect(() => {
    if (isCompactLayout) return;
    if (router.canGoBack()) {
      router.back();
    } else {
      // A cold start on a settings deep link has nothing to return to; land on
      // the workspace the modal will float over.
      leaveSettings();
    }
    openModal(view, openAddHostIntent);
  }, [isCompactLayout, openAddHostIntent, openModal, view]);

  if (!isCompactLayout) {
    return null;
  }

  return <SettingsScreen view={view} openAddHostIntent={openAddHostIntent} />;
}
