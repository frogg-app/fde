import { describe, expect, test } from "vitest";

import { resolveNonInteractiveAutostart } from "./onboard-autostart.js";

describe("non-interactive autostart", () => {
  test("FROGG_AUTOSTART decides, and nothing changes when it is unset", () => {
    expect(resolveNonInteractiveAutostart({})).toBeNull();
    expect(resolveNonInteractiveAutostart({ FROGG_AUTOSTART: "" })).toBeNull();
    expect(resolveNonInteractiveAutostart({ FROGG_AUTOSTART: "maybe" })).toBeNull();
    expect(resolveNonInteractiveAutostart({ FROGG_AUTOSTART: "1" })).toBe(true);
    expect(resolveNonInteractiveAutostart({ FROGG_AUTOSTART: "yes" })).toBe(true);
    expect(resolveNonInteractiveAutostart({ FROGG_AUTOSTART: "0" })).toBe(false);
    expect(resolveNonInteractiveAutostart({ FROGG_AUTOSTART: "off" })).toBe(false);
  });
});
