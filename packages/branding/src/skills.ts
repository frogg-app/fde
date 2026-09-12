import type { Brand } from "./schema.js";

/** Logical names stay compatible; provider directories belong to a distribution. */
export function installedSkillName(
  brand: Pick<Brand, "id" | "legacyFde">,
  logicalName: string,
): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(logicalName)) {
    throw new Error(`Invalid skill name: ${logicalName}`);
  }
  return brand.legacyFde ? logicalName : `${brand.id}-${logicalName}`;
}
