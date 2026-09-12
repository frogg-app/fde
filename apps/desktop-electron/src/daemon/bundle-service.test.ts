import { it, expect } from "vitest";
import { createBundledDaemonService, type BundledDaemonRuntime } from "./bundle-service.js";

function runtime(overrides: Partial<BundledDaemonRuntime> = {}): BundledDaemonRuntime {
  return {
    currentVersion: () => "0.4.2",
    platform: "linux",
    arch: "x64",
    inspect: async () => ({ version: "0.4.2", path: "/app/resources/daemon-bundle" }),
    restart: async () => ({ status: "running", version: "0.4.2" }),
    ...overrides,
  };
}

it("reports the built-in daemon installed and setup validates it without downloading", async () => {
  const service = createBundledDaemonService(runtime());
  expect(await service.status()).toEqual({
    installed: true,
    version: "0.4.2",
    platform: "linux",
    arch: "x64",
    path: "/app/resources/daemon-bundle",
    downloading: null,
  });
  expect(await service.install({ version: "v0.4.2" })).toEqual(await service.status());
  await expect(service.install({ version: "0.5.0" })).rejects.toThrow("Update the Electron app");
});
it("reports missing resources honestly and does not claim setup repaired them", async () => {
  const service = createBundledDaemonService(
    runtime({
      inspect: async () => {
        throw new Error("Bundled Node runtime is missing.");
      },
    }),
  );
  expect((await service.status()).installed).toBe(false);
  await expect(service.install()).rejects.toThrow("Bundled Node runtime is missing");
  expect(await service.update()).toMatchObject({
    exitCode: 1,
    stderr: "Bundled Node runtime is missing.",
  });
});
it("updates only when the running daemon actually matches the bundle", async () => {
  expect(await createBundledDaemonService(runtime()).update()).toMatchObject({
    exitCode: 0,
    stderr: "",
  });
  const otherOwner = createBundledDaemonService(
    runtime({ restart: async () => ({ status: "running", version: "0.3.0" }) }),
  );
  expect(await otherOwner.update()).toMatchObject({ exitCode: 1, stdout: "" });
});
