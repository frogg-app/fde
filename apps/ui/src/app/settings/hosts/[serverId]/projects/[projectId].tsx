import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SettingsRouteEntry } from "@/settings-modal/route-entry";
import { normalizeProjectSettingsRouteId } from "@/utils/host-routes";

export default function SettingsHostProjectDetailRoute() {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    projectId?: string | string[];
  }>();
  const serverId = normalizeProjectSettingsRouteId(params.serverId);
  const projectId = normalizeProjectSettingsRouteId(params.projectId);
  const view = useMemo(
    () => ({ kind: "project" as const, serverId, projectId }),
    [projectId, serverId],
  );

  return (
    <HostRouteBootstrapBoundary>
      <SettingsRouteEntry view={view} />
    </HostRouteBootstrapBoundary>
  );
}
