import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Fde.app/Contents/MacOS/Fde",
        shimPath: "/Applications/Fde.app/Contents/Resources/bin/fde",
      }),
    ).toBe("/Applications/Fde.app/Contents/Resources/bin/fde");
  });

  it("uses the persistent bundled shim for an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_fde123/fde",
        shimPath: "/home/user/.config/FDE Electron/daemon-bundles/0.4.2/bin/fde",
        appImagePath: "/home/user/Applications/Fde.AppImage",
      }),
    ).toBe("/home/user/.config/FDE Electron/daemon-bundles/0.4.2/bin/fde");
  });

  it("uses the bundled shim for packaged linux installs outside an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Fde/Fde",
        shimPath: "/opt/Fde/resources/bin/fde",
      }),
    ).toBe("/opt/Fde/resources/bin/fde");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Fde\\Fde.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Fde\\resources\\bin\\fde.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Fde\\resources\\bin\\fde.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Fde/fde",
        shimPath: "/opt/Fde/resources/bin/fde",
      }),
    ).toBe("/opt/Fde/resources/bin/fde");
  });
});
