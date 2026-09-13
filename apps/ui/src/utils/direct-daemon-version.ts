import { readShellProbe } from "@/network-scan/local-addresses";
import { parseDaemonIdentity } from "@/network-scan/probe";

/** Best-effort diagnosis after a failed direct connection; never replaces unknown failures. */
export async function readDirectDaemonVersion(websocketUrl: string): Promise<string | null> {
  const url = new URL(websocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/api/identity";
  url.search = "";
  url.hash = "";
  const shellProbe = readShellProbe();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      shellProbe
        ? shellProbe(url.toString())
        : fetch(url.toString(), { signal: controller.signal }).then(async (result) => ({
            status: result.status,
            body: await result.json(),
          })),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, 1000);
      }),
    ]);
    if (!response || response.status !== 200) return null;
    const identity = parseDaemonIdentity(response.body);
    return identity && (identity.product === null || identity.product === "fde")
      ? identity.version
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
