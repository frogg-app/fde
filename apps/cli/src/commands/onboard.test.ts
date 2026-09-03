import { describe, expect, test } from "vitest";

import { DEFAULT_VOICE_ENABLED } from "./onboard.js";

describe("onboarding defaults", () => {
  test("voice is enabled unless the user opts out", () => {
    expect(DEFAULT_VOICE_ENABLED).toBe(true);
  });
});
