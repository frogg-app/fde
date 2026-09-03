import assert from "node:assert/strict";
import { test } from "node:test";

import { sherpaPackageForTarget } from "./daemon-bundle-platform-packages.mjs";

test("maps bundle targets to the sherpa-onnx native package name", () => {
  assert.equal(sherpaPackageForTarget("linux", "x64"), "sherpa-onnx-linux-x64");
  assert.equal(sherpaPackageForTarget("darwin", "arm64"), "sherpa-onnx-darwin-arm64");
  // npm says win32, sherpa says win.
  assert.equal(sherpaPackageForTarget("win32", "x64"), "sherpa-onnx-win-x64");
});
