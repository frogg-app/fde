import { expect, test, vi } from "vitest";
import { brand } from "@fde/branding";
import { installers } from "@fde/branding/installers";
import { handleInstallScriptRequest } from "./install-script-worker.js";

test("serves embedded generated installers without requesting upstream templates", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  try {
    for (const name of ["install.sh", "uninstall.sh", "install-docker.sh"]) {
      const response = await handleInstallScriptRequest(
        new Request(`https://install.example/${name}`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("x-distribution-identity")).toBe(brand.applicationId);
      expect(await response.text()).toBe(installers[`/${name}`]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
test("unknown paths and mutation requests cannot serve script content", async () => {
  expect(
    (await handleInstallScriptRequest(new Request("https://install.example/secrets"))).status,
  ).toBe(404);
  expect(
    (
      await handleInstallScriptRequest(
        new Request("https://install.example/install.sh", { method: "POST" }),
      )
    ).status,
  ).toBe(405);
  const head = await handleInstallScriptRequest(
    new Request("https://install.example/install.sh", { method: "HEAD" }),
  );
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
});
