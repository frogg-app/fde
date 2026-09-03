import { getDesktopHost } from "@/desktop/host";
import { isWeb } from "@/constants/platform";
import type { SubnetHints } from "./subnets";

/**
 * What this runtime knows about its own network. The desktop shell can list
 * interface addresses through the bridge's optional `network` member; a
 * browser only knows where the page came from; React Native knows nothing,
 * so the scanner falls back to the common private subnets.
 */
export async function readLocalNetworkHints(): Promise<SubnetHints> {
  const hints: SubnetHints = {};
  const network = getDesktopHost()?.network;
  if (network?.localAddresses) {
    try {
      hints.localAddresses = await network.localAddresses();
    } catch {
      hints.localAddresses = [];
    }
  }
  if (isWeb && typeof window !== "undefined" && window.location?.hostname) {
    hints.pageHost = window.location.hostname;
  }
  return hints;
}

/** Reverse DNS through the desktop bridge when it offers one; null elsewhere. */
export async function reverseLookupHostname(ip: string): Promise<string | null> {
  const network = getDesktopHost()?.network;
  if (!network?.reverseLookup) return null;
  try {
    const name = await network.reverseLookup(ip);
    return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
  } catch {
    return null;
  }
}
