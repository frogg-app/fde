import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  require: Object.assign(vi.fn(), { resolve: vi.fn(), cache: {} as Record<string, unknown> }),
  patch: vi.fn(() => ({ status: 0, stdout: "" })),
}));
vi.mock("node:module", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:module")>()),
  createRequire: () => mocks.require,
}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.patch }));
vi.mock("./sherpa-runtime-env.js", () => ({
  applySherpaLoaderEnv: vi.fn(),
  resolveSherpaLoaderEnv: () => ({ libDir: "/platform" }),
  sherpaPlatformPackageName: () => "sherpa-onnx-test",
}));
vi.mock("../../../../paseo-env.js", () => ({ createExternalCommandProcessEnv: () => ({}) }));

const publicApi = () => ({
  OfflineRecognizer: vi.fn(),
  OnlineRecognizer: vi.fn(),
  OfflineTts: vi.fn(),
  Vad: vi.fn(),
  CircularBuffer: vi.fn(),
});
const bridge = "/wrapper/addon.js";

beforeEach(() => {
  vi.resetModules();
  mocks.require.mockReset();
  mocks.require.resolve.mockReset().mockReturnValue(bridge);
  mocks.require.cache = {};
  mocks.patch.mockClear();
});

describe("Sherpa public wrapper contract", () => {
  test("loads and caches the upstream public API without a native fallback", async () => {
    const api = publicApi();
    mocks.require.mockReturnValue(api);
    const { loadSherpaOnnxNode } = await import("./sherpa-onnx-node-loader.js");
    expect(loadSherpaOnnxNode()).toBe(api);
    expect(loadSherpaOnnxNode()).toBe(api);
    expect(mocks.require).toHaveBeenCalledTimes(1);
  });

  test("recovers a hoisted native addon through the JS wrapper, never returning raw bindings", async () => {
    const raw = { createOfflineRecognizer: vi.fn() };
    const api = publicApi();
    mocks.require.mockImplementation((target) => {
      if (target === "/platform/sherpa-onnx.node") return raw;
      if ((mocks.require.cache[bridge] as { exports?: unknown })?.exports === raw) return api;
      throw new Error("upstream relative native path missing");
    });
    const { loadSherpaOnnxNode } = await import("./sherpa-onnx-node-loader.js");
    expect(loadSherpaOnnxNode()).toBe(api);
    expect(loadSherpaOnnxNode()).not.toBe(raw);
    expect(mocks.require.cache[bridge]).toMatchObject({ loaded: true, exports: raw });
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  test("retries the public wrapper after repairing a native loading failure", async () => {
    const raw = { createOfflineRecognizer: vi.fn() };
    const api = publicApi();
    let nativeAttempts = 0;
    mocks.require.mockImplementation((target) => {
      if (target === "/platform/sherpa-onnx.node") {
        if (++nativeAttempts === 1) throw new Error("shared library missing");
        return raw;
      }
      if ((mocks.require.cache[bridge] as { exports?: unknown })?.exports === raw) return api;
      throw new Error("upstream native path missing");
    });
    const { loadSherpaOnnxNode } = await import("./sherpa-onnx-node-loader.js");
    expect(loadSherpaOnnxNode()).toBe(api);
    expect(nativeAttempts).toBe(2);
  });

  test("rejects incomplete wrapper exports and restores its previous addon cache", async () => {
    const previous = { exports: { existing: true } };
    mocks.require.cache[bridge] = previous;
    mocks.require.mockReturnValue({ createOfflineRecognizer: vi.fn() });
    const { loadSherpaOnnxNode } = await import("./sherpa-onnx-node-loader.js");
    expect(() => loadSherpaOnnxNode()).toThrow("missing the OfflineRecognizer constructor");
    expect(mocks.require.cache[bridge]).toBe(previous);
  });

  test("preserves native loader errors instead of reporting success with the wrong API", async () => {
    mocks.require.mockImplementation((target) => {
      throw new Error(
        target === "sherpa-onnx-node" ? "wrapper failed" : "native dependency missing",
      );
    });
    const { loadSherpaOnnxNode } = await import("./sherpa-onnx-node-loader.js");
    expect(() => loadSherpaOnnxNode()).toThrow("native dependency missing");
    expect(mocks.require.cache[bridge]).toBeUndefined();
  });
});
