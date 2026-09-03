import { describe, expect, test } from "vitest";

import { resolveNonInteractiveAutostart } from "./onboard-autostart.js";

describe("non-interactive autostart", () => {
  test("FDE_AUTOSTART decides, and nothing changes when it is unset", () => {
    expect(resolveNonInteractiveAutostart({})).toBeNull();
    expect(resolveNonInteractiveAutostart({ FDE_AUTOSTART: "" })).toBeNull();
    expect(resolveNonInteractiveAutostart({ FDE_AUTOSTART: "maybe" })).toBeNull();
    expect(resolveNonInteractiveAutostart({ FDE_AUTOSTART: "1" })).toBe(true);
    expect(resolveNonInteractiveAutostart({ FDE_AUTOSTART: "yes" })).toBe(true);
    expect(resolveNonInteractiveAutostart({ FDE_AUTOSTART: "0" })).toBe(false);
    expect(resolveNonInteractiveAutostart({ FDE_AUTOSTART: "off" })).toBe(false);
  });
});
