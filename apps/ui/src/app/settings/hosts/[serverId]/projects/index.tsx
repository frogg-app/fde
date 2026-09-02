import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SettingsRouteEntry } from "@/settings-modal/route-entry";
import { normalizeProjectSettingsRouteId } from "@/utils/host-routes";

export default function SettingsHostProjectsRoute() {
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const serverId = normalizeProjectSettingsRouteId(params.serverId);
  const view = useMemo(
    () => ({ kind: "host" as const, serverId, section: "projects" as const }),
    [serverId],
  );

  return (
    <HostRouteBootstrapBoundary>
      <SettingsRouteEntry view={view} />
    </HostRouteBootstrapBoundary>
  );
}
