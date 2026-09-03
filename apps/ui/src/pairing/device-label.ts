import Constants from "expo-constants";
import { Platform } from "react-native";
import { isElectronRuntime } from "@/desktop/host";

const PLATFORM_NAMES: Record<string, string> = {
  ios: "iPhone",
  android: "Android",
  web: "browser",
  macos: "Mac",
  windows: "Windows",
};

/**
 * The label the daemon records for this device when it is claimed
 * (`principals.json`, shown by `fde daemon claim-status`). Best effort: the
 * device name where the platform exposes it, otherwise the app flavour.
 */
export function resolveDeviceLabel(input?: { deviceName?: string | null }): string {
  const deviceName = (input?.deviceName ?? Constants.deviceName ?? "").trim();
  const flavour = isElectronRuntime()
    ? "FDE Desktop"
    : `FDE (${PLATFORM_NAMES[Platform.OS] ?? Platform.OS})`;
  return deviceName ? `${flavour} on ${deviceName}` : flavour;
}
