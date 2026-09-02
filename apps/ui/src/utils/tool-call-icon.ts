import type { ComponentType } from "react";
import {
  Bot,
  Brain,
  Eye,
  MicVocal,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react-native";
import type { ToolCallDetail } from "@fde/protocol/agent-types";
import { FdeLogo } from "@/components/icons/fde-logo";
import { resolveToolCallIconName, type ToolCallIcon } from "./tool-call-icon-name";

export type ToolCallIconComponent = ComponentType<{ size?: number; color?: string }>;

const ICON_COMPONENTS: Record<ToolCallIcon, ToolCallIconComponent> = {
  wrench: Wrench,
  square_terminal: SquareTerminal,
  eye: Eye,
  pencil: Pencil,
  search: Search,
  bot: Bot,
  sparkles: Sparkles,
  brain: Brain,
  mic_vocal: MicVocal,
  paseo: FdeLogo,
};

export function componentForToolCallIcon(name: ToolCallIcon): ToolCallIconComponent {
  return ICON_COMPONENTS[name];
}

export function resolveToolCallIcon(
  toolName: string,
  detail?: ToolCallDetail,
): ToolCallIconComponent {
  return componentForToolCallIcon(resolveToolCallIconName(toolName, detail));
}
