import { describe, expect, test } from "vitest";
import { parseListenString } from "./listen-target.js";

describe("listen address defaults", () => {
  test.each(["9999", " 9999 ", ":9999"])(
    "binds omitted host %s to all IPv4 interfaces",
    (listen) => {
      expect(parseListenString(listen)).toEqual({ type: "tcp", host: "0.0.0.0", port: 9999 });
    },
  );
  test.each(["127.0.0.1:9999", "[::1]:9999"])("preserves explicit host %s", (listen) => {
    expect(parseListenString(listen)).toEqual({
      type: "tcp",
      host: listen.startsWith("[") ? "::1" : "127.0.0.1",
      port: 9999,
    });
  });
});
