import { Resolver } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";

export function localAddresses(): string[] {
  return [
    ...new Set(
      Object.values(networkInterfaces()).flatMap((addresses) =>
        (addresses ?? [])
          .filter(
            (entry) =>
              entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."),
          )
          .map((entry) => entry.cidr ?? entry.address),
      ),
    ),
  ];
}

export async function reverseLookup(ip: unknown): Promise<string | null> {
  if (typeof ip !== "string" || !isIPv4(ip)) throw new Error("Expected an IPv4 address");
  const resolver = new Resolver({ timeout: 500, tries: 1 });
  const timeout = setTimeout(() => resolver.cancel(), 700);
  try {
    return (await resolver.reverse(ip))[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function validateProbeUrl(input: unknown): URL {
  if (typeof input !== "string") throw new Error("Expected a URL");
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/api/identity", "/api/health"].includes(url.pathname)
  ) {
    throw new Error("Expected an HTTP(S) /api/identity or /api/health URL");
  }
  return url;
}

export async function probeIdentity(input: unknown): Promise<{ status: number; body: unknown }> {
  const url = validateProbeUrl(input);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(700),
    redirect: "error",
  });
  // Bound response memory independently of a potentially dishonest Content-Length.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 256 * 1024) throw new Error("Identity response exceeds 256 KiB");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
  }
  let body: unknown = null;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    /* Non-JSON health response. */
  }
  return { status: response.status, body };
}
