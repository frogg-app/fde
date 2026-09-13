import { app } from "electron";
import path from "node:path";
import { brand } from "@frogg/branding";
import { createDesktopSettingsStore, type DesktopSettingsStore } from "./desktop-settings.js";
import { migrateTauriSettings } from "./tauri-migration.js";

let desktopSettingsStore: DesktopSettingsStore | null = null;
export function getDesktopSettingsStore(): DesktopSettingsStore {
  if (desktopSettingsStore) return desktopSettingsStore;
  const store = createDesktopSettingsStore({
    userDataPath: app.getPath("userData"),
  });
  const migration = app.isPackaged
    ? migrateTauriSettings(
        path.join(app.getPath("appData"), brand.applicationId),
        app.getPath("userData"),
      ).catch((error) => {
        console.warn("Could not import Tauri desktop settings:", error);
      })
    : Promise.resolve();
  desktopSettingsStore = {
    async get() {
      await migration;
      return store.get();
    },
    async patch(value) {
      await migration;
      return store.patch(value);
    },
    async migrateLegacyRendererSettings(value) {
      await migration;
      return store.migrateLegacyRendererSettings(value);
    },
  };
  return desktopSettingsStore;
}
