import type { Brand } from "./schema.js";

export interface BrandIdentity {
  id: string;
  applicationId: string;
}
export function matchesBrand(expected: BrandIdentity, actual: unknown): boolean {
  if (actual === null || actual === undefined) return expected.id === "fde";
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
  const selected = env[`${brand.envPrefix}_${suffix}`]?.trim();
  if (selected) return selected;
  if (brand.legacyFde)
    return env[`FDE_${suffix}`]?.trim() || env[`PASEO_${suffix}`]?.trim() || undefined;
  return undefined;
}

export function storageKey(brand: Brand, key: string): string {
  return `${brand.storagePrefix}${key}`;
}
