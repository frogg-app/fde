import { router, type Href } from "expo-router";
import { navigateToLastWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSettingsModalStore } from "@/settings-modal/store";
import {
  buildOpenProjectRoute,
  buildProjectSettingsRoute,
  buildProjectsSettingsRoute,
  buildSettingsHostRoute,
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
  buildSettingsSectionRoute,
  type HostSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";

export type SettingsView =
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "hostRoot"; serverId: string }
  | { kind: "host"; serverId: string; section: HostSectionSlug }
  | { kind: "project"; serverId: string; projectId: string };

export function buildSettingsViewRoute(view: SettingsView): Href {
  switch (view.kind) {
    case "root":
      return buildSettingsRoute();
    case "section":
      return buildSettingsSectionRoute(view.section);
    case "hostRoot":
      return buildSettingsHostRoute(view.serverId);
    case "host":
      return buildSettingsHostSectionRoute(view.serverId, view.section);
    case "project":
      return buildProjectSettingsRoute(view.serverId, view.projectId);
  }
}

/**
 * Settings lives in two presentations: the full-screen `/settings` routes on
 * compact layouts, and a modal on wide layouts. Every hop between settings
 * views goes through here so callers never branch on presentation. While the
 * modal is open, a hop swaps its view; otherwise it is a route navigation, and
 * on a wide layout the route itself opens the modal (see `SettingsRouteEntry`).
 */
export function navigateSettings(view: SettingsView, options?: { replace?: boolean }): void {
  const modal = useSettingsModalStore.getState();
  if (modal.view !== null) {
    modal.setView(view);
    return;
  }
  const route = buildSettingsViewRoute(view);
  if (options?.replace) {
    router.replace(route);
  } else {
    router.push(route);
  }
}

/**
 * App settings and host settings are separate surfaces: app settings list only
 * app sections, and a host's settings list only that host's sections.
 */
export type SettingsScope = { kind: "app" } | { kind: "host"; serverId: string };

export function resolveSettingsScope(view: SettingsView): SettingsScope {
  switch (view.kind) {
    case "root":
    case "section":
      return { kind: "app" };
    case "hostRoot":
    case "host":
    case "project":
      return { kind: "host", serverId: view.serverId };
  }
}

/** Opens a host's settings: its section list on compact layouts, its overview in the modal. */
export function openHostSettings(serverId: string): void {
  navigateSettings({ kind: "hostRoot", serverId });
}

export function openHostOverview(serverId: string): void {
  navigateSettings({ kind: "host", serverId, section: "host" });
}

export function openProjectSettings(serverId: string, projectId: string): void {
  navigateSettings({ kind: "project", serverId, projectId });
}

/** Leaves settings for another route, closing the modal first when it is open. */
export function leaveSettingsFor(href: Href): void {
  useSettingsModalStore.getState().close();
  router.push(href);
}

/** Leaves settings for the workspace the user came from. */
export function leaveSettings(): void {
  const modal = useSettingsModalStore.getState();
  if (modal.view !== null) {
    modal.close();
    return;
  }
  if (!navigateToLastWorkspace()) {
    router.replace(buildOpenProjectRoute());
  }
}

/** Steps up one level: a project detail returns to its host's project list, anything else leaves. */
export function returnFromSettings(view: SettingsView): void {
  const modal = useSettingsModalStore.getState();
  if (modal.view !== null) {
    if (view.kind === "project") {
      modal.setView({ kind: "host", serverId: view.serverId, section: "projects" });
    } else {
      modal.close();
    }
    return;
  }

  if (view.kind === "root" || view.kind === "hostRoot") {
    leaveSettings();
    return;
  }

  let parent: Href = buildSettingsRoute();
  if (view.kind === "project") parent = buildProjectsSettingsRoute(view.serverId);
  if (view.kind === "host") parent = buildSettingsHostRoute(view.serverId);
  router.dismissTo(parent);
}
