import { describe, expect, it } from "vitest";
import { parseDaemonPortInput, resolveRemoteSshTarget } from "./remote-ssh-target";

describe("parseDaemonPortInput", () => {
  it("treats blank as the default port", () => {
    expect(parseDaemonPortInput("")).toBe(9999);
    expect(parseDaemonPortInput("   ")).toBe(9999);
  });

  it("accepts whole ports in range and rejects the rest", () => {
    expect(parseDaemonPortInput("7000")).toBe(7000);
    expect(parseDaemonPortInput(" 1 ")).toBe(1);
    expect(parseDaemonPortInput("0")).toBeNull();
    expect(parseDaemonPortInput("65536")).toBeNull();
    expect(parseDaemonPortInput("70a")).toBeNull();
    expect(parseDaemonPortInput("-5")).toBeNull();
  });
});

describe("resolveRemoteSshTarget", () => {
  const base = { selectedAlias: null, daemonPortText: "", manualTarget: "" };

  it("submits ssh://<alias> for a config host so ssh resolves the alias itself", () => {
    expect(resolveRemoteSshTarget({ ...base, mode: "config", selectedAlias: "build-box" })).toEqual(
      {
        ok: true,
        uri: "ssh://build-box",
        target: { host: "build-box", daemonPort: 9999 },
      },
    );
  });

  it("appends a non-default daemon port for a config host", () => {
    expect(
      resolveRemoteSshTarget({
        ...base,
        mode: "config",
        selectedAlias: "build-box",
        daemonPortText: "7000",
      }),
    ).toEqual({
      ok: true,
      uri: "ssh://build-box?daemonPort=7000",
      target: { host: "build-box", daemonPort: 7000 },
    });
  });

  it("requires a highlighted host and a valid daemon port on the config tab", () => {
    expect(resolveRemoteSshTarget({ ...base, mode: "config" })).toEqual({
      ok: false,
      error: "hostRequired",
    });
    expect(
      resolveRemoteSshTarget({
        ...base,
        mode: "config",
        selectedAlias: "build-box",
        daemonPortText: "99999",
      }),
    ).toEqual({ ok: false, error: "invalidDaemonPort" });
  });

  it("parses the typed URI on the manual tab", () => {
    expect(
      resolveRemoteSshTarget({
        ...base,
        mode: "manual",
        manualTarget: " ssh://deploy@example.com:2222?daemonPort=7777 ",
      }),
    ).toEqual({
      ok: true,
      uri: "ssh://deploy@example.com:2222?daemonPort=7777",
      target: { host: "deploy@example.com", sshPort: 2222, daemonPort: 7777 },
    });
  });

  it("reports an empty or malformed manual target", () => {
    expect(resolveRemoteSshTarget({ ...base, mode: "manual" })).toEqual({
      ok: false,
      error: "targetRequired",
    });
    expect(
      resolveRemoteSshTarget({ ...base, mode: "manual", manualTarget: "example.com" }),
    ).toEqual({ ok: false, error: "invalidTarget" });
    expect(
      resolveRemoteSshTarget({ ...base, mode: "manual", manualTarget: "ssh://h?foo=1" }),
    ).toEqual({ ok: false, error: "invalidTarget" });
  });

  it("ignores manual text while on the config tab and vice versa", () => {
    expect(
      resolveRemoteSshTarget({
        mode: "config",
        selectedAlias: "dev",
        daemonPortText: "",
        manualTarget: "ssh://other",
      }),
    ).toMatchObject({ ok: true, uri: "ssh://dev" });
    expect(
      resolveRemoteSshTarget({
        mode: "manual",
        selectedAlias: "dev",
        daemonPortText: "not a port",
        manualTarget: "ssh://other",
      }),
    ).toMatchObject({ ok: true, uri: "ssh://other" });
  });
});
