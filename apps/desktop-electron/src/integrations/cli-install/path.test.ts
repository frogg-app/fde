import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Frogg.app/Contents/MacOS/Frogg",
        shimPath: "/Applications/Frogg.app/Contents/Resources/bin/frogg",
      }),
    ).toBe("/Applications/Frogg.app/Contents/Resources/bin/frogg");
  });

  it("uses the persistent bundled shim for an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_fde123/frogg",
        shimPath: "/home/user/.config/Frogg Electron/daemon-bundles/0.4.2/bin/frogg",
        appImagePath: "/home/user/Applications/Frogg.AppImage",
      }),
    ).toBe("/home/user/.config/Frogg Electron/daemon-bundles/0.4.2/bin/frogg");
  });

  it("uses the bundled shim for packaged linux installs outside an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Frogg/Frogg",
        shimPath: "/opt/Frogg/resources/bin/frogg",
      }),
    ).toBe("/opt/Frogg/resources/bin/frogg");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Frogg\\Frogg.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Frogg\\resources\\bin\\frogg.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Frogg\\resources\\bin\\frogg.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Frogg/frogg",
        shimPath: "/opt/Frogg/resources/bin/frogg",
      }),
    ).toBe("/opt/Frogg/resources/bin/frogg");
  });
});
