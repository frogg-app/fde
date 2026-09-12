import type { Brand } from "./schema.js";

export interface BrandIdentity {
  id: string;
  applicationId: string;
}
export function matchesBrand(
  expected: BrandIdentity,
  actual: BrandIdentity | null | undefined,
): boolean {
  return actual
    ? actual.id === expected.id && actual.applicationId === expected.applicationId
    : expected.id === "fde";
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
