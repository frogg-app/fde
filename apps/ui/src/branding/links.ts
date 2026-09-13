import { brand } from "@frogg/branding";

export function brandDocsUrl(page = ""): string | null {
  return brand.links.docs
    ? `${brand.links.docs.replace(/\/$/, "")}${page ? `/${page}` : ""}`
    : null;
}
