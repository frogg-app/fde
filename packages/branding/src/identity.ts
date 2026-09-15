import type { Brand } from "./schema.js";

export interface BrandIdentity {
  id: string;
  applicationId: string;
}

/** Map a branded environment namespace onto the stable internal FROGG names. */
export function normalizeBrandEnvironment(
  brand: Brand,
  env: Record<string, string | undefined>,
): void {
  const prefix = brand.envPrefix.replace(/_+$/, "");
  if (!prefix || prefix === "FROGG") return;
  const marker = `${prefix}_`;
  const legacyKeys = Object.keys(env).filter((key) => key.startsWith("FROGG_"));
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(marker)) {
      const internal = `FROGG_${key.slice(marker.length)}`;
      if (env[internal] === undefined) env[internal] = value;
    }
  }
  // Branded builds intentionally stop accepting the upstream namespace.
  for (const key of legacyKeys) delete env[key];
}
export function matchesBrand(expected: BrandIdentity, actual: unknown): boolean {
  if (actual === null || actual === undefined) return expected.id === "frogg";
  return (
    typeof actual === "object" &&
    "id" in actual &&
    "applicationId" in actual &&
    actual.id === expected.id &&
    actual.applicationId === expected.applicationId
  );
}

export function brandEnv(
  brand: Brand,
  env: Record<string, string | undefined>,
  suffix: string,
): string | undefined {
  const prefix = brand.envPrefix.replace(/_+$/, "");
  return (
    env[`${prefix}_${suffix}`]?.trim() ||
    (brand.legacyFrogg ? env[`FROGG_${suffix}`]?.trim() : undefined) ||
    undefined
  );
}

export function storageKey(brand: Brand, key: string): string {
  return `${brand.storagePrefix}${key}`;
}
