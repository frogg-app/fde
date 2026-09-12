import { resolvedBrand } from "./generated/brand.js";
import type { Brand } from "./schema.js";

function freeze(value: object): void {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freeze(child);
  }
  Object.freeze(value);
}
freeze(resolvedBrand);
export const brand: Brand = resolvedBrand;
export const brandIdentity = Object.freeze({
  id: brand.id,
  name: brand.name,
  applicationId: brand.applicationId,
});
