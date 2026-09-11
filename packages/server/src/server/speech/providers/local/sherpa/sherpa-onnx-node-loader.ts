import Module, { createRequire } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  applySherpaLoaderEnv,
  resolveSherpaLoaderEnv,
  sherpaPlatformPackageName,
} from "./sherpa-runtime-env.js";
import { createExternalCommandProcessEnv } from "../../../../paseo-env.js";

export interface SherpaOnnxNodeModule {
  OfflineRecognizer: new (config: unknown) => unknown;
  OnlineRecognizer?: new (config: unknown) => unknown;
  OfflineTts?: new (config: unknown) => unknown;
  Vad?: new (config: unknown, bufferSizeInSeconds: number) => unknown;
  CircularBuffer?: new (capacity: number) => unknown;
}

let cached: SherpaOnnxNodeModule | null = null;

interface LoadAttempt {
  target: string;
  error: unknown;
}

function appendAttempt(attempts: LoadAttempt[], target: string, error: unknown): void {
  attempts.push({ target, error });
}

function formatError(error: unknown): string {
  if (!error) {
    return "unknown error";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function maybePatchLinuxAddonRunpath(addonPath: string): void {
  if (process.platform !== "linux") {
    return;
  }
  const patchelfEnv = createExternalCommandProcessEnv("patchelf", process.env);
  const patchelfCheck = spawnSync("patchelf", ["--version"], {
    env: patchelfEnv,
    stdio: "ignore",
  });
  if (patchelfCheck.status !== 0) {
    return;
  }

  const currentRpath = spawnSync("patchelf", ["--print-rpath", addonPath], {
    encoding: "utf8",
    env: patchelfEnv,
  });
  if (currentRpath.status !== 0) {
    return;
  }
  const rpath = (currentRpath.stdout ?? "").trim();
  if (rpath.includes("$ORIGIN")) {
    return;
  }

  spawnSync("patchelf", ["--set-rpath", "$ORIGIN", addonPath], {
    env: patchelfEnv,
    stdio: "ignore",
  });
}

function loadWithRequire(
  requireFn: NodeRequire,
  target: string,
  attempts: LoadAttempt[],
): SherpaOnnxNodeModule | null {
  try {
    const loaded = requireFn(target) as SherpaOnnxNodeModule;
    for (const name of [
      "OfflineRecognizer",
      "OnlineRecognizer",
      "OfflineTts",
      "Vad",
      "CircularBuffer",
    ] as const) {
      if (typeof loaded?.[name] !== "function") {
        throw new Error(`sherpa-onnx-node wrapper is missing the ${name} constructor`);
      }
    }
    return loaded;
  } catch (error) {
    appendAttempt(attempts, target, error);
    return null;
  }
}

/** Bridge upstream's relative-only native lookup to Node's resolved platform package.
 * The .node addon exports low-level functions, not the public JS constructors.
 * All wrapper modules share addon.js; seed that one cache entry and load the
 * actual wrapper so its stream, recognizer, TTS, and VAD adapters stay intact.
 */
function loadWrapperWithAddon(
  requireFn: NodeRequire,
  addonPath: string,
  attempts: LoadAttempt[],
): SherpaOnnxNodeModule | null {
  let bridgePath: string | undefined;
  let previous: NodeModule | undefined;
  try {
    bridgePath = requireFn.resolve("sherpa-onnx-node/addon.js");
    previous = requireFn.cache[bridgePath];
    const native = requireFn(addonPath);
    const bridge = new Module(bridgePath);
    bridge.filename = bridgePath;
    bridge.loaded = true;
    bridge.exports = native;
    requireFn.cache[bridgePath] = bridge;
    const wrapper = loadWithRequire(requireFn, "sherpa-onnx-node", attempts);
    if (wrapper) return wrapper;
  } catch (error) {
    appendAttempt(attempts, addonPath, error);
  }
  if (bridgePath) {
    if (previous) requireFn.cache[bridgePath] = previous;
    else delete requireFn.cache[bridgePath];
  }
  return null;
}

function buildFailure(attempts: LoadAttempt[], pkgName: string): Error {
  const details = attempts
    .map((attempt) => `- ${attempt.target}: ${formatError(attempt.error)}`)
    .join("\n");
  const message = [
    `Failed to load sherpa-onnx-node for ${process.platform}-${process.arch}.`,
    `Node ${process.version} (ABI ${process.versions.modules}).`,
    `Platform package: ${pkgName}.`,
    "Load attempts:",
    details || "- (no attempts made)",
  ].join("\n");
  return new Error(message);
}

export function loadSherpaOnnxNode(): SherpaOnnxNodeModule {
  if (cached) {
    return cached;
  }

  const require = createRequire(import.meta.url);
  const attempts: LoadAttempt[] = [];

  // Pass through upstream support matrix first.
  const direct = loadWithRequire(require, "sherpa-onnx-node", attempts);
  if (direct) {
    cached = direct;
    return cached;
  }

  // sherpa-onnx-node depends on a platform-specific package (e.g. sherpa-onnx-darwin-arm64)
  // that contains the native addon and shared libraries.
  const pkgName = sherpaPlatformPackageName();
  const resolvedEnv = resolveSherpaLoaderEnv();
  const platformPkgDir = resolvedEnv?.libDir ?? null;

  if (platformPkgDir) {
    applySherpaLoaderEnv(process.env);
    const addonPath = path.join(platformPkgDir, "sherpa-onnx.node");

    if (existsSync(addonPath)) {
      const byPath = loadWrapperWithAddon(require, addonPath, attempts);
      if (byPath) {
        cached = byPath;
        return cached;
      }

      // Linux fallback for broken prebuilt RUNPATHs.
      maybePatchLinuxAddonRunpath(addonPath);
      const afterPatch = loadWrapperWithAddon(require, addonPath, attempts);
      if (afterPatch) {
        cached = afterPatch;
        return cached;
      }
    }
  }

  throw buildFailure(attempts, pkgName);
}
