import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveBrand, root } from "./resolve.mjs";

export async function checkWebBuild(): Promise<boolean> {
  try {
    const stamp = JSON.parse(
      await readFile(path.join(root, "apps/ui/dist/brand-build.json"), "utf8"),
    );
    return stamp.configFingerprint === resolveBrand().fingerprint;
  } catch {
    return false;
  }
}
if (process.argv[2] === "stamp") {
  const { brand, version, fingerprint } = resolveBrand();
  await writeFile(
    path.join(root, "apps/ui/dist/brand-build.json"),
    JSON.stringify({
      brand: { id: brand.id, applicationId: brand.applicationId },
      version,
      configFingerprint: fingerprint,
    }) + "\n",
  );
}
