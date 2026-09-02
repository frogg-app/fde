import { useEffect } from "react";
import { router, useNavigationContainerRef } from "expo-router";
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
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    if (isCompactLayout) return;
    let frame: number | null = null;
    const openAndLeaveRoute = () => {
      // A cold start on a settings deep link runs this effect before the
      // navigation container is ready; navigating then throws. Poll until it is.
      if (!navigationRef.isReady()) {
        frame = requestAnimationFrame(openAndLeaveRoute);
        return;
      }
      frame = null;
      if (router.canGoBack()) {
        router.back();
      } else {
        // Nothing to return to; land on the workspace the modal will float over.
        leaveSettings();
      }
      openModal(view, openAddHostIntent);
    };
    openAndLeaveRoute();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [isCompactLayout, navigationRef, openAddHostIntent, openModal, view]);

  if (!isCompactLayout) {
    return null;
  }

  return <SettingsScreen view={view} openAddHostIntent={openAddHostIntent} />;
}
