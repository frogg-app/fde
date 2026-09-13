import { it, expect } from "vitest";
import {
  buildSshArgs,
  parseOpenTransportSessionInput,
  parseProtocols,
} from "./transport-endpoint.js";

it("carries daemon bearer protocols and SSH password separately, preserving IPv6 hosts", () => {
  const input = parseOpenTransportSessionInput({
    sessionId: "ssh-1",
    target: {
      transportType: "ssh",
      host: "user@2001:db8::1",
      daemonPort: 10099,
      sshPassword: "private password",
    },
    protocols: ["frogg", "frogg.bearer.token"],
  });
  expect(input.protocols).toEqual(["frogg", "frogg.bearer.token"]);
  if (input.target.transportType !== "ssh") throw new Error("Expected SSH");
  const args = buildSshArgs(input.target);
  expect(args).toContain("NumberOfPasswordPrompts=1");
  expect(args).not.toContain("BatchMode=yes");
  expect(args).not.toContain("private password");
  expect(args.slice(-3)).toEqual(["-W", "127.0.0.1:10099", "user@2001:db8::1"]);
});
it("rejects malformed or duplicate handshake subprotocols before opening a socket", () => {
  for (const protocols of [["ok\r\nAuthorization: leak"], ["same", "same"], "protocol"])
    expect(() => parseProtocols(protocols)).toThrow();
});
