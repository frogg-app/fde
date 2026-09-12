import path from "node:path";
import { readFile } from "node:fs/promises";
import { writeFile } from "./config.mjs";
import { outputRoot, root, type BrandBuild } from "./resolve.mjs";

/** Stable package/path identities with independently editable display labels. */
export async function nativePresentation({ brand }: BrandBuild) {
  if (brand.legacyFde) return { bundle: {}, nsis: {} };
  const desktop = path.join(outputRoot, "app.desktop");
  const plist = path.join(outputRoot, "Info.plist");
  const installer = path.join(outputRoot, "installer.nsi");
  const xml = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  // Desktop values are single lines; backslashes have defined escaping semantics.
  await writeFile(
    desktop,
    `[Desktop Entry]\nType=Application\nName={{comment}}\nExec={{exec}}\nIcon={{icon}}\nStartupWMClass={{exec}}\nCategories={{categories}}\nTerminal=false\n{{#if mime_type}}\nMimeType={{mime_type}}\n{{/if}}\n`,
  );
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleDisplayName</key><string>${xml(brand.name)}</string></dict></plist>\n`,
  );
  let template = await readFile(
    path.join(root, "packages/branding/templates/installer.nsi"),
    "utf8",
  );
  // Replace exact upstream template anchors, failing clearly if a future update moves one.
  const patches = [
    ['!define PRODUCTNAME "{{product_name}}"', '!define PRODUCTNAME "{{short_description}}"'],
    ["Uninstall\\${PRODUCTNAME}", "Uninstall\\${BUNDLEID}"],
    ['!define MANUKEY "Software\\${MANUFACTURER}"', '!define MANUKEY "Software\\${BUNDLEID}"'],
    ['!define MANUPRODUCTKEY "${MANUKEY}\\${PRODUCTNAME}"', '!define MANUPRODUCTKEY "${MANUKEY}"'],
    ["placeholder\\${PRODUCTNAME}", "placeholder\\${BUNDLEID}"],
    [
      '!define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"',
      '!define MULTIUSER_INSTALLMODE_INSTDIR "${BUNDLEID}"',
    ],
    ...["PROGRAMFILES64", "PROGRAMFILES", "LOCALAPPDATA"].map((folder) => [
      `$${folder}\\\${PRODUCTNAME}`,
      `$${folder}\\\${BUNDLEID}`,
    ]),
  ];
  for (const [from, to] of patches) {
    if (!template.includes(from))
      throw new Error(`Tauri installer template changed: missing ${from}`);
    template = template.replaceAll(from, () => to);
  }
  await writeFile(installer, template);
  return {
    bundle: {
      linux: { deb: { desktopTemplate: desktop }, rpm: { desktopTemplate: desktop } },
      macOS: { bundleName: brand.name, infoPlist: plist },
    },
    nsis: { template: installer },
  };
}
