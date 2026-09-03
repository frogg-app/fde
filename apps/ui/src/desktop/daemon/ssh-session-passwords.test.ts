import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionSshPasswords,
  forgetSessionSshPassword,
  getSessionSshPassword,
  rememberSessionSshPassword,
} from "./ssh-session-passwords";

describe("ssh-session-passwords", () => {
  afterEach(() => clearSessionSshPasswords());

  it("keys passwords by host and ssh port", () => {
    rememberSessionSshPassword({ host: "dev@box" }, "one");
    rememberSessionSshPassword({ host: "dev@box", sshPort: 2222 }, "two");
    expect(getSessionSshPassword({ host: "dev@box" })).toBe("one");
    expect(getSessionSshPassword({ host: " dev@box " })).toBe("one");
    expect(getSessionSshPassword({ host: "dev@box", sshPort: 2222 })).toBe("two");
    expect(getSessionSshPassword({ host: "other" })).toBeUndefined();
  });

  it("forgets on request and on an empty password", () => {
    rememberSessionSshPassword({ host: "box" }, "pw");
    forgetSessionSshPassword({ host: "box" });
    expect(getSessionSshPassword({ host: "box" })).toBeUndefined();
    rememberSessionSshPassword({ host: "box" }, "pw");
    rememberSessionSshPassword({ host: "box" }, "");
    expect(getSessionSshPassword({ host: "box" })).toBeUndefined();
  });
});
