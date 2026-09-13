import { valid } from "semver";

export interface ReleaseDescriptor {
  schemaVersion: 1;
  version: string;
  runtime: "electron";
  minimumClientVersion: string;
  channel: "electron-latest" | "electron-beta";
}

/** Missing descriptors identify older Electron releases; other failures remain visible. */
export async function fetchReleaseDescriptor(url: string): Promise<unknown | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Release descriptor failed (${response.status}).`);
  return response.json();
}

export function parseReleaseDescriptor(value: unknown): ReleaseDescriptor {
  if (!value || typeof value !== "object") throw new Error("Invalid release descriptor.");
  if (
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("runtime" in value) ||
    value.runtime !== "electron" ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    !valid(value.version) ||
    !("minimumClientVersion" in value) ||
    typeof value.minimumClientVersion !== "string" ||
    !valid(value.minimumClientVersion) ||
    !("channel" in value) ||
    (value.channel !== "electron-latest" && value.channel !== "electron-beta")
  ) {
    throw new Error("Unsupported release descriptor schema, runtime, version or channel.");
  }
  const expectedChannel = value.version.includes("-") ? "electron-beta" : "electron-latest";
  if (value.channel !== expectedChannel)
    throw new Error("Release descriptor channel does not match its version.");
  return {
    schemaVersion: 1,
    runtime: "electron",
    version: value.version,
    channel: value.channel,
    minimumClientVersion: value.minimumClientVersion,
  };
}
