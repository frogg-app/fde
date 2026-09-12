import { describe, expect, it } from "vitest";
import { isTrustedDesktopFrame, isAllowedDesktopPermission } from "./ipc-policy.js";
import { PairingInbox } from "./pairing-inbox.js";
import { validateProbeUrl } from "./network-service.js";

describe("desktop IPC trust boundary", () => {
  const trusted = {
    registered: true,
    mainFrame: true,
    url: "fde://app/settings",
    origin: "fde://app",
  };
  it("accepts registered app main-frame routes", () => {
    expect(isTrustedDesktopFrame(trusted)).toBe(true);
    expect(
      isTrustedDesktopFrame({
        ...trusted,
        url: "http://192.168.1.4:8081/agent/x",
        origin: "http://192.168.1.4:8081",
      }),
    ).toBe(true);
  });
  it("rejects guest frames, unregistered windows and origin changes", () => {
    for (const input of [
      { ...trusted, registered: false },
      { ...trusted, mainFrame: false },
      { ...trusted, url: "fde://other/settings" },
      { ...trusted, url: "https://app/settings" },
      { ...trusted, url: "about:blank" },
      { ...trusted, url: "invalid" },
    ])
      expect(isTrustedDesktopFrame(input)).toBe(false);
  });
});

describe("pairing launch inbox", () => {
  it("delivers a cold-start link once after the listener registers", () => {
    const inbox = new PairingInbox();
    const delivered: string[] = [];
    const url = "fde://pair#offer=secret";
    expect(inbox.receive(url)).toBe(true);
    inbox.ready(1, (value) => delivered.push(value));
    inbox.ready(1, (value) => delivered.push(value));
    expect(delivered).toEqual([url]);
  });
  it("queues across renderer reload and never delivers unrelated links", () => {
    const inbox = new PairingInbox();
    const delivered: string[] = [];
    inbox.ready(1, (value) => delivered.push(value));
    inbox.remove(1);
    expect(inbox.receive("https://example.com/#offer=secret")).toBe(false);
    inbox.receive("fde://pair#offer=next");
    expect(delivered).toEqual([]);
    inbox.ready(2, (value) => delivered.push(value));
    expect(delivered).toEqual(["fde://pair#offer=next"]);
  });
});

describe("network probe destinations", () => {
  it("accepts daemon identity and health endpoints", () => {
    expect(validateProbeUrl("http://192.168.1.17:9999/api/identity").port).toBe("9999");
    expect(validateProbeUrl("https://host/api/health").protocol).toBe("https:");
  });
  it("rejects credentials, other protocols, paths and query strings", () => {
    for (const value of [
      null,
      "file:///api/identity",
      "http://host/",
      "http://user:pass@host/api/health",
      "http://host/api/identity?token=x",
      "http://host/api/identity#x",
    ]) {
      expect(() => validateProbeUrl(value)).toThrow();
    }
  });
});

it("permits app voice and local daemon access without granting unrelated devices", () => {
  for (const permission of [
    "media",
    "speaker-selection",
    "local-network",
    "local-network-access",
    "loopback-network",
  ]) {
    expect(isAllowedDesktopPermission(permission)).toBe(true);
  }
  for (const permission of ["usb", "serial", "geolocation", "display-capture"]) {
    expect(isAllowedDesktopPermission(permission)).toBe(false);
  }
});
