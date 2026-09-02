import type { ComponentType } from "react";
import {
  Settings,
  Palette,
  Server,
  Network,
  Bot,
  Boxes,
  Gauge,
  Keyboard,
  Stethoscope,
  Info,
  Bell,
  Shield,
  Puzzle,
  FolderGit2,
  SquareTerminal,
  Code2,
  Smartphone,
  Sparkles,
  Blocks,
  PanelsTopLeft,
} from "lucide-react-native";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";

export interface SidebarSectionItem {
  id: SettingsSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
  desktopOnly?: boolean;
  webOnly?: boolean;
  requiresKeyboardShortcuts?: boolean;
}

export const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", labelKey: "settings.sections.general", icon: Settings },
  { id: "appearance", labelKey: "settings.sections.appearance", icon: Palette },
  {
    id: "layout",
    labelKey: "settings.sections.layout",
    icon: PanelsTopLeft,
    desktopOnly: true,
  },
  { id: "editor", labelKey: "settings.sections.editor", icon: Code2, webOnly: true },
  {
    id: "shortcuts",
    labelKey: "settings.sections.shortcuts",
    icon: Keyboard,
    requiresKeyboardShortcuts: true,
  },
  {
    id: "integrations",
    labelKey: "settings.sections.integrations",
    icon: Puzzle,
    desktopOnly: true,
  },
  {
    id: "notifications",
    labelKey: "settings.sections.notifications",
    icon: Bell,
    desktopOnly: true,
  },
  {
    id: "permissions",
    labelKey: "settings.sections.permissions",
    icon: Shield,
    desktopOnly: true,
  },
  { id: "diagnostics", labelKey: "settings.sections.diagnostics", icon: Stethoscope },
  { id: "about", labelKey: "settings.sections.about", icon: Info },
];

export interface HostSectionItem {
  id: HostSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
}

export const HOST_SECTION_ITEMS: HostSectionItem[] = [
  { id: "host", labelKey: "settings.hostSections.host", icon: Server },
  { id: "projects", labelKey: "settings.hostSections.projects", icon: FolderGit2 },
  { id: "connections", labelKey: "settings.hostSections.connections", icon: Network },
  { id: "pair-device", labelKey: "openProject.tiles.pairDevice.title", icon: Smartphone },
  { id: "agents", labelKey: "settings.hostSections.agents", icon: Bot },
  { id: "metadata", labelKey: "settings.hostSections.metadata", icon: Sparkles },
  { id: "workspaces", labelKey: "settings.hostSections.workspaces", icon: FolderGit2 },
  { id: "providers", labelKey: "settings.hostSections.providers", icon: Boxes },
  { id: "usage", labelKey: "settings.hostSections.usage", icon: Gauge },
  { id: "terminals", labelKey: "settings.hostSections.terminals", icon: SquareTerminal },
  { id: "plugins", labelKey: "settings.hostSections.plugins", icon: Blocks },
];
