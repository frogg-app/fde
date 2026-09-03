import { describe, expect, test } from "vitest";

import { DEFAULT_VOICE_ENABLED, resolveNonInteractiveVoiceDefault } from "./onboard.js";

describe("onboarding defaults", () => {
  test("voice is enabled unless the user opts out", () => {
    expect(DEFAULT_VOICE_ENABLED).toBe(true);
    expect(resolveNonInteractiveVoiceDefault({})).toBe(true);
    expect(resolveNonInteractiveVoiceDefault({ PASEO_VOICE: "0" })).toBe(false);
    expect(resolveNonInteractiveVoiceDefault({ PASEO_VOICE: "off" })).toBe(false);
    expect(resolveNonInteractiveVoiceDefault({ PASEO_VOICE: "1" })).toBe(true);
    expect(resolveNonInteractiveVoiceDefault({ PASEO_VOICE: "garbage" })).toBe(true);
  });
});
