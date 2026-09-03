import { describe, expect, it } from "vitest";
import { resolveVoicePermissionIntent } from "./permission-intent";

describe("resolveVoicePermissionIntent", () => {
  it.each(["Yes.", "yeah go ahead", "Okay, approve it", "Allow", "Sure, do it!", "All right"])(
    "reads %j as allow",
    (transcript) => {
      expect(resolveVoicePermissionIntent(transcript)).toEqual({ kind: "allow" });
    },
  );

  it.each(["No", "nope", "Deny that.", "Don't.", "Cancel", "No, stop"])(
    "reads %j as deny",
    (transcript) => {
      expect(resolveVoicePermissionIntent(transcript)).toEqual({ kind: "deny" });
    },
  );

  it("treats mixed signals, silence, and anything message-length as ambiguous", () => {
    expect(resolveVoicePermissionIntent("yes but no")).toEqual({ kind: "ambiguous" });
    expect(resolveVoicePermissionIntent("   ")).toEqual({ kind: "ambiguous" });
    expect(resolveVoicePermissionIntent("hmm let me think")).toEqual({ kind: "ambiguous" });
    expect(
      resolveVoicePermissionIntent("No, use the other approach and keep the existing tests"),
    ).toEqual({ kind: "ambiguous" });
  });

  it("does not match phrases inside other words", () => {
    expect(resolveVoicePermissionIntent("nobody")).toEqual({ kind: "ambiguous" });
    expect(resolveVoicePermissionIntent("okayish")).toEqual({ kind: "ambiguous" });
  });
});
