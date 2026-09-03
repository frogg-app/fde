import { describe, expect, it } from "vitest";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { classifyRemoteSshFailure, parseSshAuthMethods } from "./remote-ssh-failure";

function testError(message: string, lastError: string | null = null) {
  return new DaemonConnectionTestError(message, { reason: message, lastError });
}

describe("parseSshAuthMethods", () => {
  it("reads the method list of the last Permission denied line", () => {
    expect(
      parseSshAuthMethods(
        "Permission denied, please try again.\nme@box: Permission denied (publickey,password).",
      ),
    ).toEqual(["publickey", "password"]);
    expect(parseSshAuthMethods("Permission denied (publickey).")).toEqual(["publickey"]);
    expect(parseSshAuthMethods("Permission denied, please try again.")).toBeNull();
    expect(parseSshAuthMethods("Connection refused")).toBeNull();
  });
});

describe("classifyRemoteSshFailure", () => {
  it("tells the daemon's password apart from ssh's", () => {
    expect(classifyRemoteSshFailure(testError("Password required"))).toEqual({
      kind: "daemon-password-required",
    });
    expect(classifyRemoteSshFailure(testError("Unable to connect", "Incorrect password"))).toEqual({
      kind: "daemon-password-incorrect",
    });
    expect(
      classifyRemoteSshFailure(
        testError(
          "Failed to connect to Remote SSH host box: ssh exited before the tunnel opened: me@box: Permission denied (publickey,password).",
        ),
      ),
    ).toEqual({ kind: "ssh-auth", methods: ["publickey", "password"] });
    expect(
      classifyRemoteSshFailure(new Error("Permission denied (keyboard-interactive).")),
    ).toEqual({ kind: "ssh-auth", methods: ["keyboard-interactive"] });
  });

  it("does not prompt for a password when only keys are accepted", () => {
    expect(classifyRemoteSshFailure(testError("Permission denied (publickey)."))).toBeNull();
    expect(classifyRemoteSshFailure(testError("Connection timed out"))).toBeNull();
    expect(classifyRemoteSshFailure(null)).toBeNull();
  });

  it("recognises an unknown or changed host key", () => {
    expect(classifyRemoteSshFailure("Host key verification failed.")).toEqual({
      kind: "ssh-host-key",
    });
    expect(
      classifyRemoteSshFailure(
        testError(
          "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nPermission denied (password).",
        ),
      ),
    ).toEqual({ kind: "ssh-host-key" });
  });
});
