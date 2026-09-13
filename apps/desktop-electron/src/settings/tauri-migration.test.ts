import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { migrateTauriSettings } from "./tauri-migration.js";
import { createDesktopSettingsStore } from "./desktop-settings.js";

it("imports Tauri preferences once without altering either existing profile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "frogg-settings-migration-"));
  try {
    const source = path.join(root, "tauri");
    const target = path.join(root, "electron");
    await mkdir(source);
    const document = JSON.stringify({
      version: 1,
      settings: {
        releaseChannel: "beta",
        daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
        updates: { autoCheck: false },
      },
      migrations: { daemonStopOnQuitDefaultApplied: true },
    });
    await writeFile(path.join(source, "desktop-settings.json"), document);
    await migrateTauriSettings(source, target);
    const store = createDesktopSettingsStore({ userDataPath: target });
    expect(await store.get()).toMatchObject({
      releaseChannel: "beta",
      updates: { autoCheck: false },
      daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: false },
    });
    await store.patch({ updates: { autoCheck: true } });
    await migrateTauriSettings(source, target);
    expect(
      (await createDesktopSettingsStore({ userDataPath: target }).get()).updates.autoCheck,
    ).toBe(true);
    expect(await readFile(path.join(source, "desktop-settings.json"), "utf8")).toBe(document);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
