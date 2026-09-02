import { describe, expect, it } from "vitest";
import {
  buildSshConfigHostTarget,
  formatSshConfigHostDetails,
  parseSshConfigHosts,
} from "./ssh-config-hosts";

describe("buildSshConfigHostTarget", () => {
  it("uses the alias alone so ssh resolves the rest from the config", () => {
    expect(buildSshConfigHostTarget({ alias: "build-box" })).toBe("ssh://build-box");
  });
});

describe("formatSshConfigHostDetails", () => {
  it("formats user@hostName:port and omits missing parts", () => {
    const base = {
      alias: "dev",
      hostName: "dev.example.com",
      user: null,
      port: null,
      identityFile: null,
    };
    expect(formatSshConfigHostDetails(base)).toBe("dev.example.com");
    expect(formatSshConfigHostDetails({ ...base, user: "alice" })).toBe("alice@dev.example.com");
    expect(formatSshConfigHostDetails({ ...base, user: "alice", port: 2222 })).toBe(
      "alice@dev.example.com:2222",
    );
    expect(formatSshConfigHostDetails({ ...base, hostName: null, user: "alice" })).toBe("");
  });
});

describe("parseSshConfigHosts", () => {
  it("keeps well-formed entries and drops the rest", () => {
    expect(
      parseSshConfigHosts([
        { alias: "dev", hostName: "dev.example.com", user: "alice", port: 2222 },
        { alias: " " },
        "nope",
        { alias: "bare", port: 70000 },
      ]),
    ).toEqual([
      { alias: "dev", hostName: "dev.example.com", user: "alice", port: 2222, identityFile: null },
      { alias: "bare", hostName: null, user: null, port: null, identityFile: null },
    ]);
    expect(parseSshConfigHosts(null)).toEqual([]);
  });
});
