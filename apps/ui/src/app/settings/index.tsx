import { SettingsRouteEntry } from "@/settings-modal/route-entry";

const ROOT_VIEW = { kind: "root" as const };

export default function SettingsIndexRoute() {
  return <SettingsRouteEntry view={ROOT_VIEW} />;
}
