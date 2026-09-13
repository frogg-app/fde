import { useMemo } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { SettingsRouteEntry } from "@/settings-modal/route-entry";
import { buildSettingsRoute } from "@/utils/host-routes";

export default function SettingsHostIndexRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  const view = useMemo(() => ({ kind: "hostRoot" as const, serverId }), [serverId]);

  if (!serverId) {
    return <Redirect href={buildSettingsRoute()} />;
  }

  return <SettingsRouteEntry view={view} />;
}
