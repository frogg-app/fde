import { describe, expect, it } from "vitest";
import {
  defaultSshDeployListen,
  describeSshDeployPlatform,
  parseSshDeployEvent,
  parseSshDeployProbe,
  sshDeployPrimaryAction,
  sshDeployServiceKind,
  type SshDeployProbe,
} from "./ssh-deploy";

const probe: SshDeployProbe = {
  os: "Linux",
  arch: "x86_64",
  hasDocker: true,
  hasSystemdUser: true,
  hasCurl: true,
  hasFde: { installed: true, version: "0.1.6" },
  hasDockerContainer: false,
  homeDir: "/home/me",
};

describe("parseSshDeployProbe", () => {
  it("normalises the shell's report", () => {
    expect(
      parseSshDeployProbe({
        os: " Linux ",
        arch: "x86_64",
        hasDocker: true,
        hasSystemdUser: true,
        hasCurl: true,
        hasFde: { installed: true, version: "0.1.6" },
        hasDockerContainer: false,
        homeDir: "/home/me",
      }),
    ).toEqual(probe);
  });

  it("treats a missing or blank version as unknown and non-boolean flags as false", () => {
    expect(parseSshDeployProbe({ hasFde: { installed: false }, hasDocker: "yes" })).toEqual({
      os: "",
      arch: "",
      hasDocker: false,
      hasSystemdUser: false,
      hasCurl: false,
      hasFde: { installed: false, version: null },
      hasDockerContainer: false,
      homeDir: "",
    });
    expect(parseSshDeployProbe({ hasFde: { installed: true, version: "  " } }).hasFde).toEqual({
      installed: true,
      version: null,
    });
  });

  it("rejects a non-object result", () => {
    expect(() => parseSshDeployProbe(null)).toThrow();
    expect(() => parseSshDeployProbe("ok")).toThrow();
  });
});

describe("parseSshDeployEvent", () => {
  it("parses the three event kinds", () => {
    expect(parseSshDeployEvent({ jobId: "deploy-1", kind: "log", text: "hi" })).toEqual({
      jobId: "deploy-1",
      kind: "log",
      text: "hi",
      stream: "stdout",
    });
    expect(
      parseSshDeployEvent({ jobId: "deploy-1", kind: "log", text: "warn", stream: "stderr" }),
    ).toMatchObject({ stream: "stderr" });
    expect(parseSshDeployEvent({ jobId: "deploy-1", kind: "done" })).toEqual({
      jobId: "deploy-1",
      kind: "done",
      text: null,
    });
    expect(
      parseSshDeployEvent({ jobId: "deploy-1", kind: "error", detail: "boom", cancelled: true }),
    ).toEqual({ jobId: "deploy-1", kind: "error", detail: "boom", cancelled: true });
  });

  it("drops events without a job id or with an unknown kind", () => {
    expect(parseSshDeployEvent({ kind: "log", text: "x" })).toBeNull();
    expect(parseSshDeployEvent({ jobId: "j", kind: "progress" })).toBeNull();
    expect(parseSshDeployEvent(undefined)).toBeNull();
  });
});

describe("deploy card helpers", () => {
  it("defaults the listen address to loopback on the saved daemon port", () => {
    expect(defaultSshDeployListen()).toBe("127.0.0.1:6767");
    expect(defaultSshDeployListen(7000)).toBe("127.0.0.1:7000");
  });

  it("describes the platform and the service manager", () => {
    expect(describeSshDeployPlatform(probe)).toBe("Linux x86_64");
    expect(describeSshDeployPlatform({ os: "", arch: "" })).toBe("");
    expect(sshDeployServiceKind(probe)).toBe("systemd");
    expect(sshDeployServiceKind({ os: "Darwin", hasSystemdUser: false })).toBe("launchd");
    expect(sshDeployServiceKind({ os: "Linux", hasSystemdUser: false })).toBe("none");
  });

  it("picks deploy, upgrade or reinstall per method and version", () => {
    expect(sshDeployPrimaryAction(probe, "native", "0.1.7")).toBe("upgrade");
    expect(sshDeployPrimaryAction(probe, "native", "v0.1.6")).toBe("reinstall");
    expect(sshDeployPrimaryAction(probe, "native", null)).toBe("upgrade");
    expect(sshDeployPrimaryAction(probe, "docker", "0.1.7")).toBe("deploy");
    expect(sshDeployPrimaryAction({ ...probe, hasDockerContainer: true }, "docker", "0.1.7")).toBe(
      "upgrade",
    );
    expect(
      sshDeployPrimaryAction(
        { ...probe, hasFde: { installed: false, version: null } },
        "native",
        "1",
      ),
    ).toBe("deploy");
  });
});
