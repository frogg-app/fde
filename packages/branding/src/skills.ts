import type { Brand } from "./schema.js";

/** Logical names stay compatible; provider directories belong to a distribution. */
export function installedSkillName(
  brand: Pick<Brand, "id" | "legacyFrogg">,
  logicalName: string,
): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(logicalName)) {
    throw new Error(`Invalid skill name: ${logicalName}`);
  }
  return brand.legacyFrogg ? logicalName : `${brand.id}-${logicalName}`;
}
