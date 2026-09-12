import { expect, it } from "vitest";
import { getSharedRuntime } from "./shared-runtime";

it("retains the connected owner when a hot reload replaces its constructor", () => {
  const registry = {};
  class OriginalRuntime {
    connectionStatus = "online";
  }
  class ReloadedRuntime {
    connectionStatus = "connecting";
  }
  const original = getSharedRuntime(registry, "runtime", () => new OriginalRuntime());
  let replacements = 0;
  const reloaded = getSharedRuntime(registry, "runtime", () => {
    replacements++;
    return new ReloadedRuntime();
  });
  expect(original instanceof ReloadedRuntime).toBe(false);
  expect(reloaded).toBe(original);
  expect(reloaded.connectionStatus).toBe("online");
  expect(replacements).toBe(0);
});

it("adopts an owner registered before the reload-safe accessor existed", () => {
  const owner = { connectionStatus: "online" };
  expect(
    getSharedRuntime({ runtime: owner }, "runtime", () => ({ connectionStatus: "idle" })),
  ).toBe(owner);
});
