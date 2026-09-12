import { constants } from "node:fs";
import { copyFile, mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";

/** Copy only the settings document; Chromium/WebView profiles are incompatible. */
export async function migrateTauriSettings(
  sourceDirectory: string,
  userDataPath: string,
): Promise<void> {
  const destination = path.join(userDataPath, "desktop-settings.json");
  try {
    await access(destination);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const source = path.join(sourceDirectory, "desktop-settings.json");
  try {
    const value = JSON.parse(await readFile(source, "utf8")) as {
      version?: unknown;
      settings?: unknown;
    };
    if (value.version !== 1 || !value.settings || typeof value.settings !== "object") return;
    await mkdir(userDataPath, { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
    throw error;
  }
}
