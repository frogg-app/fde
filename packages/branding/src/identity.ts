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
  return env[`${brand.envPrefix}_${suffix}`]?.trim() || undefined;
}

export function storageKey(brand: Brand, key: string): string {
  return `${brand.storagePrefix}${key}`;
}
