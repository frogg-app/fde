import { getDesktopHost } from "@/desktop/host";
import { isWeb } from "@/constants/platform";
import type { ShellProbeLike } from "./probe";
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
    } catch (error) {
      hints.localAddresses = [];
      hints.localAddressesError = error instanceof Error ? error.message : String(error);
    }
  }
  if (isWeb && typeof window !== "undefined" && window.location?.hostname) {
    hints.pageHost = window.location.hostname;
  }
  return hints;
}

let nextProbeId = 0;

/** Native probes avoid the webview's cross-origin and local-network restrictions. */
export function readShellProbe(): ShellProbeLike | undefined {
  const network = getDesktopHost()?.network;
  const probe = network?.probeIdentity;
  if (!network || !probe) return undefined;
  return async (url, signal) => {
    if (signal?.aborted) throw new Error("Scan cancelled");
    const requestId = `scan-${++nextProbeId}`;
    const cancel = () => {
      void network.cancelProbe?.(requestId).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await probe(url, requestId);
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  };
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
