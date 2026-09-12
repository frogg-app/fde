import { describe, expect, it, vi } from "vitest";
import { runDesktopStartup } from "./desktop-startup";

describe("desktop startup", () => {
  it("inherits the login-shell environment before opening the client", async () => {
    const calls: string[] = [];
    await runDesktopStartup({
      inheritLoginShellEnv: vi.fn(() => calls.push("env")),
      bootstrapGui: vi.fn(async () => {
        calls.push("gui");
      }),
    });
    expect(calls).toEqual(["env", "gui"]);
  });
});
