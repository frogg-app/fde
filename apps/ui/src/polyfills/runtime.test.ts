import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createContext, runInContext } from "node:vm";
import { transformSync } from "@babel/core";
import { describe, expect, it } from "vitest";

const nodeRequire = createRequire(import.meta.url);
const appRoot = path.resolve(import.meta.dirname, "../..");
const entryPath = path.join(appRoot, "index.ts");
const terminalBundle = readFileSync(nodeRequire.resolve("@xterm/headless"), "utf8");

function executeEntry(source = readFileSync(entryPath, "utf8")) {
  // Android Hermes exposes navigator.product, but neither userAgent nor Node process APIs.
  const context = createContext({ process: {}, navigator: { product: "ReactNative" } });
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const events: string[] = [];
  let consumerState: unknown;
  function evaluateCommonJs(code: string, filename: string) {
    const module = { exports: {} as Record<string, unknown> };
    modules.set(filename, module);
    const evaluate = runInContext(`(function(require, module, exports) {\n${code}\n})`, context, {
      filename,
    });
    evaluate((request: string) => load(request, filename), module, module.exports);
    return module.exports;
  }
  function load(request: string, importer: string): unknown {
    if (request === "expo-crypto") {
      return {
        getRandomValues(array: ArrayBufferView) {
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(1);
          return array;
        },
      };
    }
    if (request === "buffer") return { Buffer };
    if (request === "expo-router/entry") {
      events.push("router");
      // Execute the installed bundle itself; mocking Terminal would hide the real crash.
      const terminal = evaluateCommonJs(terminalBundle, "xterm-headless.js");
      expect(typeof terminal.Terminal).toBe("function");
      consumerState = JSON.parse(
        runInContext(
          `JSON.stringify({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        encoded: Array.from(new TextEncoder().encode("FDE ✓")),
        decoded: new TextDecoder().decode(new TextEncoder().encode("FDE ✓")),
        uuid: crypto.randomUUID(),
        random: Array.from(crypto.getRandomValues(new Uint8Array(2)))
      })`,
          context,
        ),
      );
      return {};
    }
    const filename = path.resolve(path.dirname(importer), `${request}.ts`);
    if (filename === path.join(appRoot, "src/styles/unistyles.ts")) {
      events.push("styles");
      return {};
    }
    if (!request.startsWith("."))
      throw new Error(`Unexpected native startup dependency: ${request}`);
    const cached = modules.get(filename);
    if (cached) return cached.exports;
    return evaluateTypeScript(readFileSync(filename, "utf8"), filename);
  }
  function evaluateTypeScript(code: string, filename: string) {
    // Babel hoists static requires before statements, matching Metro's ESM import semantics.
    // TypeScript's basic CJS emitter alone would incorrectly let old entry calls run first.
    const transformed = transformSync(code, {
      filename,
      babelrc: false,
      configFile: false,
      plugins: [
        nodeRequire.resolve("@babel/plugin-transform-typescript"),
        nodeRequire.resolve("@babel/plugin-transform-modules-commonjs"),
      ],
    });
    if (!transformed?.code) throw new Error(`No transformed code for ${filename}`);
    return evaluateCommonJs(transformed.code, filename);
  }
  evaluateTypeScript(source, entryPath);
  return { events, consumerState };
}

describe("native entry runtime initialization", () => {
  it("installs navigator and crypto/text globals before the actual terminal bundle is imported", () => {
    const result = executeEntry();
    expect(result.events).toEqual(["styles", "router"]);
    expect(result.consumerState).toEqual({
      userAgent: "ReactNative",
      platform: "",
      encoded: [70, 68, 69, 32, 226, 156, 147],
      decoded: "FDE ✓",
      uuid: "01010101-0101-4101-8101-010101010101",
      random: [1, 1],
    });
  });

  it("reproduces the native includes crash when polyfill calls live after static imports", () => {
    const lateInitialization = `
      import { polyfillNavigator } from "./src/polyfills/navigator";
      import { polyfillCrypto } from "./src/polyfills/crypto";
      polyfillNavigator();
      polyfillCrypto();
      import "./src/styles/unistyles";
      import "expo-router/entry";
    `;
    expect(() => executeEntry(lateInitialization)).toThrow(/includes/);
  });
});
