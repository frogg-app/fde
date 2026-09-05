import { PanelRight } from "lucide-react-native";
import { type StyleProp, type ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import type { ShortcutKey } from "@/utils/format-shortcut";

const ThemedPanelRight = withUnistyles(PanelRight);

interface WorkspaceExplorerToggleProps {
  onPress: () => void;
  label: string;
  tooltipLabel: string;
  tooltipKeys: ShortcutKey[];
  accessibilityState: { expanded: boolean };
  mobile: boolean;
  style?: StyleProp<ViewStyle>;
}

export type WorkspaceExplorerToggleOwner = "mobile" | "header" | "window";

export function resolveWorkspaceExplorerToggleOwner({
  isMobile,
  hasMacTrafficLights,
}: {
  isMobile: boolean;
  hasMacTrafficLights: boolean;
}): WorkspaceExplorerToggleOwner {
  if (isMobile) return "mobile";
  return hasMacTrafficLights ? "window" : "header";
}

export function WorkspaceExplorerToggle({
  onPress,
  label,
  tooltipLabel,
  tooltipKeys,
  accessibilityState,
  mobile,
  style,
}: WorkspaceExplorerToggleProps) {
  return (
    <HeaderToggleButton
      testID="workspace-explorer-toggle"
      onPress={onPress}
      tooltipLabel={tooltipLabel}
      tooltipKeys={tooltipKeys}
      tooltipSide="left"
      style={style}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
    >
      <ThemedPanelRight
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mobile ? mutedIconColorMapping : extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}

interface DesktopWorkspaceExplorerToggleProps extends Omit<WorkspaceExplorerToggleProps, "mobile"> {
  owner: WorkspaceExplorerToggleOwner;
}

/**
 * The workspace header owns the toggle only while the sidebar is collapsed. Once
 * it is open, the sidebar carries its own close button so the control sits next
 * to the thing it closes instead of across the window.
 */
export function shouldShowHeaderExplorerToggle({
  owner,
  expanded,
}: {
  owner: WorkspaceExplorerToggleOwner;
  expanded: boolean;
}): boolean {
  return owner !== "mobile" && !expanded;
}

/** The open sidebar renders its own close button on every desktop platform. */
export function shouldShowSidebarExplorerToggle({
  owner,
  expanded,
}: {
  owner: WorkspaceExplorerToggleOwner;
  expanded: boolean;
}): boolean {
  return owner !== "mobile" && expanded;
}

export function WorkspaceHeaderExplorerToggle({
  owner,
  accessibilityState,
  style,
  ...toggleProps
}: DesktopWorkspaceExplorerToggleProps) {
  if (!shouldShowHeaderExplorerToggle({ owner, expanded: accessibilityState.expanded })) {
    return null;
  }
  return (
    <WorkspaceExplorerToggle
      {...toggleProps}
      accessibilityState={accessibilityState}
      mobile={false}
      style={style}
    />
  );
}

export function WorkspaceExplorerSidebarToggle({
  owner,
  accessibilityState,
  ...toggleProps
}: DesktopWorkspaceExplorerToggleProps) {
  if (!shouldShowSidebarExplorerToggle({ owner, expanded: accessibilityState.expanded })) {
    return null;
  }
  return (
    <WorkspaceExplorerToggle
      {...toggleProps}
      accessibilityState={accessibilityState}
      mobile={false}
    />
  );
}
