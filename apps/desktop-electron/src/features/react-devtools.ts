import { session } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface ReactDevToolsContentScript {
  matches: string[];
  js: string[];
  run_at: "document_start" | "document_end";
  world?: "MAIN";
}

interface ReactDevToolsManifest {
  version?: string;
  manifest_version?: number;
  content_scripts?: ReactDevToolsContentScript[];
}

const ELECTRON_COMPATIBLE_CONTENT_SCRIPTS: ReactDevToolsContentScript[] = [
  {
    matches: ["<all_urls>"],
    js: ["build/proxy.js"],
    run_at: "document_start",
  },
  {
    matches: ["<all_urls>"],
    js: ["build/installHook.js"],
    run_at: "document_start",
    world: "MAIN",
  },
  {
    matches: ["<all_urls>"],
    js: ["build/hookSettingsInjector.js"],
    run_at: "document_start",
  },
  {
    matches: ["<all_urls>"],
    js: ["build/fileFetcher.js"],
    run_at: "document_end",
  },
];

function hasStaticReactHookScript(manifest: ReactDevToolsManifest): boolean {
  return (
    manifest.content_scripts?.some((script) => script.js.includes("build/installHook.js")) ?? false
  );
}

async function patchReactDevToolsForElectron(extensionPath: string): Promise<void> {
  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as ReactDevToolsManifest;

  if (manifest.manifest_version !== 3 || hasStaticReactHookScript(manifest)) {
    return;
  }

  // React DevTools v7 relies on chrome.scripting.registerContentScripts,
  // which Electron does not reliably inject into app pages. Static scripts do.
  manifest.content_scripts = ELECTRON_COMPATIBLE_CONTENT_SCRIPTS;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[DevTools] Patched React DevTools ${manifest.version} content scripts for Electron`);
}

export async function loadReactDevTools(): Promise<void> {
  const configuredPath = process.env.FROGG_ELECTRON_REACT_DEVTOOLS_DIR?.trim();
  if (!configuredPath) {
    throw new Error(
      "Set FROGG_ELECTRON_REACT_DEVTOOLS_DIR to an unpacked React DevTools extension.",
    );
  }
  const extensionPath = path.resolve(configuredPath);
  try {
    await patchReactDevToolsForElectron(extensionPath);
    const ext = await session.defaultSession.extensions.loadExtension(extensionPath, {
      allowFileAccess: true,
    });
    console.log(`[DevTools] Loaded: ${ext.name}`);
  } catch (err) {
    console.warn("[DevTools] Failed to load React DevTools:", err);
  }
}
