import { describe, expect, it } from "vitest";
import {
  DirectEndpointInputError,
  describeDirectEndpointInput,
  parseDirectEndpointInput,
  previewDirectEndpointInput,
} from "./direct-endpoint-input";

describe("parseDirectEndpointInput", () => {
  it("defaults a bare host to port 9999 without TLS", () => {
    expect(parseDirectEndpointInput("frogbox")).toEqual({
      host: "frogbox",
      port: 9999,
      isIpv6: false,
      useTls: false,
    });
  });

  it("accepts host:port, with and without a trailing slash", () => {
    expect(parseDirectEndpointInput("192.168.1.10:9999")).toMatchObject({
      host: "192.168.1.10",
      port: 9999,
      useTls: false,
    });
    expect(parseDirectEndpointInput("192.168.1.10:6767/")).toMatchObject({
      host: "192.168.1.10",
      port: 6767,
    });
  });

  it("keeps an explicit legacy 6767 port", () => {
    expect(parseDirectEndpointInput("localhost:6767").port).toBe(6767);
  });

  it("honours a custom default port", () => {
    expect(parseDirectEndpointInput("frogbox", { defaultPort: 6767 }).port).toBe(6767);
  });

  it("parses http and https URLs, with scheme default ports", () => {
    expect(parseDirectEndpointInput("http://frogbox:9999")).toMatchObject({
      host: "frogbox",
      port: 9999,
      useTls: false,
    });
    expect(parseDirectEndpointInput("http://frogbox/")).toMatchObject({ port: 80, useTls: false });
    expect(parseDirectEndpointInput("https://fde.example.com")).toMatchObject({
      host: "fde.example.com",
      port: 443,
      useTls: true,
    });
    expect(parseDirectEndpointInput("HTTPS://fde.example.com:8443/")).toMatchObject({
      port: 8443,
      useTls: true,
    });
  });

  it("parses ws and wss URLs and ignores the path", () => {
    expect(parseDirectEndpointInput("ws://10.0.0.5:9999/ws")).toMatchObject({
      host: "10.0.0.5",
      port: 9999,
      useTls: false,
    });
    expect(parseDirectEndpointInput("wss://10.0.0.5:9999/ws/")).toMatchObject({
      port: 9999,
      useTls: true,
    });
  });

  it("keeps the legacy tcp form working, including ssl and password", () => {
    expect(parseDirectEndpointInput("tcp://localhost:6767?ssl=true")).toEqual({
      host: "localhost",
      port: 6767,
      isIpv6: false,
      useTls: true,
    });
    expect(parseDirectEndpointInput("tcp://localhost:9999/?password=hunter2")).toMatchObject({
      port: 9999,
      useTls: false,
      password: "hunter2",
    });
    expect(parseDirectEndpointInput("tcp://frogbox").port).toBe(9999);
  });

  it("handles IPv6 literals bracketed, bare and with a port", () => {
    expect(parseDirectEndpointInput("[::1]:9999")).toEqual({
      host: "::1",
      port: 9999,
      isIpv6: true,
      useTls: false,
    });
    expect(parseDirectEndpointInput("::1")).toMatchObject({
      host: "::1",
      port: 9999,
      isIpv6: true,
    });
    expect(parseDirectEndpointInput("http://[fe80::1]:9999/")).toMatchObject({
      host: "fe80::1",
      isIpv6: true,
    });
  });

  it("trims whitespace", () => {
    expect(parseDirectEndpointInput("  frogbox:9999  ").host).toBe("frogbox");
  });

  it("rejects empty, unsupported schemes, bad ports and userinfo", () => {
    expect(() => parseDirectEndpointInput("   ")).toThrow(DirectEndpointInputError);
    expect(() => parseDirectEndpointInput("ftp://frogbox")).toThrow(/Unsupported scheme/);
    expect(() => parseDirectEndpointInput("frogbox:99999")).toThrow(/between 1 and 65535/);
    expect(() => parseDirectEndpointInput("frogbox:abc")).toThrow(/Invalid connection address/);
    expect(() => parseDirectEndpointInput("http://user:pw@frogbox")).toThrow(/Credentials/);
  });
});

describe("describeDirectEndpointInput", () => {
  it("resolves the WebSocket URL and storage URI", () => {
    const described = describeDirectEndpointInput(parseDirectEndpointInput("https://frogbox:9999"));
    expect(described).toEqual({
      endpoint: "frogbox:9999",
      webSocketUrl: "wss://frogbox:9999/ws",
      storageUri: "tcp://frogbox:9999?ssl=true",
    });
  });

  it("brackets IPv6 in the endpoint", () => {
    expect(describeDirectEndpointInput(parseDirectEndpointInput("::1")).endpoint).toBe(
      "[::1]:9999",
    );
  });
});

describe("previewDirectEndpointInput", () => {
  it("returns the WebSocket URL for valid input and null otherwise", () => {
    expect(previewDirectEndpointInput("192.168.1.10")).toBe("ws://192.168.1.10:9999/ws");
    expect(previewDirectEndpointInput("")).toBeNull();
    expect(previewDirectEndpointInput("ftp://x")).toBeNull();
  });
});
