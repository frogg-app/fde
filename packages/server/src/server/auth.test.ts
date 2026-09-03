import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createAccessPolicy, type DaemonAccessPolicy } from "./access-policy.js";
import { createClaimStore } from "./claim-store.js";
import {
  authorizeBearerAsync,
  extractHttpBearerToken,
  extractWsBearerProtocol,
  extractWsBearerToken,
  hashDaemonPassword,
  isAgentMcpRequestAuthorized,
  isBearerTokenValidAsync,
  isBearerTokenValid,
  requestNeedsBearer,
  shouldBypassBearerAuth,
} from "./auth.js";

const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

describe("daemon bearer validator", () => {
  test("allows any token when no password is configured", () => {
    expect(isBearerTokenValid({ password: undefined, token: null })).toBe(true);
    expect(isBearerTokenValid({ password: undefined, token: "anything" })).toBe(true);
  });

  test("accepts the plaintext token against the bcrypt hash and rejects missing or wrong tokens", async () => {
    expect(
      await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "correct-password" }),
    ).toBe(true);
    expect(isBearerTokenValid({ password: CORRECT_PASSWORD_HASH, token: "correct-password" })).toBe(
      true,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: null })).toBe(
      false,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "wrong" })).toBe(
      false,
    );
  });

  test("hashes a password into a bcrypt value", () => {
    const hash = hashDaemonPassword("correct-password");

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(isBearerTokenValid({ password: hash, token: "correct-password" })).toBe(true);
  });

  test("extracts HTTP bearer tokens", () => {
    expect(extractHttpBearerToken("Bearer secret")).toBe("secret");
    expect(extractHttpBearerToken("Basic secret")).toBeNull();
    expect(extractHttpBearerToken(undefined)).toBeNull();
  });

  test("extracts WebSocket paseo bearer subprotocol tokens", () => {
    const protocol = extractWsBearerProtocol("chat, paseo.bearer.secret.with.dots");

    expect(protocol).toBe("paseo.bearer.secret.with.dots");
    expect(extractWsBearerToken(protocol)).toBe("secret.with.dots");
    expect(extractWsBearerToken("paseo.other.secret")).toBeNull();
  });

  test("bypasses bearer auth for preflight, liveness, and capability-token routes", () => {
    // Preflight is always bypassed regardless of path.
    expect(shouldBypassBearerAuth("OPTIONS", "/api/status")).toBe(true);
    // Unauthenticated liveness probe.
    expect(shouldBypassBearerAuth("GET", "/api/health")).toBe(true);
    // Guarded by its own single-use download token, not the daemon password.
    expect(shouldBypassBearerAuth("GET", "/api/files/download")).toBe(true);
    // Guarded by its own per-daemon-run capability token (see
    // isAgentMcpRequestAuthorized), not the daemon password.
    expect(shouldBypassBearerAuth("POST", "/mcp/agents")).toBe(true);
    // Everything else stays behind the daemon password.
    expect(shouldBypassBearerAuth("GET", "/api/status")).toBe(false);
    expect(shouldBypassBearerAuth("POST", "/api/files/upload")).toBe(false);
  });
});

describe("agent MCP request authorizer", () => {
  const CAPABILITY_TOKEN = "cap-token-abc123";

  test("allows any request when no daemon password is configured", async () => {
    expect(
      await isAgentMcpRequestAuthorized({
        password: undefined,
        capabilityToken: CAPABILITY_TOKEN,
        authorizationHeader: undefined,
      }),
    ).toBe(true);
  });

  test("accepts the injected capability token", async () => {
    expect(
      await isAgentMcpRequestAuthorized({
        password: CORRECT_PASSWORD_HASH,
        capabilityToken: CAPABILITY_TOKEN,
        authorizationHeader: `Bearer ${CAPABILITY_TOKEN}`,
      }),
    ).toBe(true);
  });

  test("still accepts a valid daemon-password bearer", async () => {
    expect(
      await isAgentMcpRequestAuthorized({
        password: CORRECT_PASSWORD_HASH,
        capabilityToken: CAPABILITY_TOKEN,
        authorizationHeader: "Bearer correct-password",
      }),
    ).toBe(true);
  });

  test("rejects requests presenting neither the token nor a valid password", async () => {
    expect(
      await isAgentMcpRequestAuthorized({
        password: CORRECT_PASSWORD_HASH,
        capabilityToken: CAPABILITY_TOKEN,
        authorizationHeader: undefined,
      }),
    ).toBe(false);
    expect(
      await isAgentMcpRequestAuthorized({
        password: CORRECT_PASSWORD_HASH,
        capabilityToken: CAPABILITY_TOKEN,
        authorizationHeader: "Bearer wrong-token",
      }),
    ).toBe(false);
  });
});

describe("bearer requirement by client locality", () => {
  interface MatrixCase {
    trustLan: boolean;
    password: string | undefined;
    client: "loopback" | "lan" | "public";
    needsBearer: boolean;
  }

  const SOCKETS: Record<MatrixCase["client"], string> = {
    loopback: "127.0.0.1",
    lan: "::ffff:192.168.1.10",
    public: "203.0.113.5",
  };

  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function policyFor(trustLan: boolean): DaemonAccessPolicy {
    const home = mkdtempSync(path.join(tmpdir(), "fde-auth-matrix-"));
    homes.push(home);
    return createAccessPolicy({
      claimStore: createClaimStore(home),
      getTrustedProxies: () => ["loopback"],
      getTrustLan: () => trustLan,
    });
  }

  function requestFrom(address: string, forwardedFor?: string): IncomingMessage {
    return {
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
      socket: { remoteAddress: address },
    } as unknown as IncomingMessage;
  }

  const MATRIX: MatrixCase[] = [
    // trustLan on (the default): loopback and the LAN are open, the internet is not.
    { trustLan: true, password: undefined, client: "loopback", needsBearer: false },
    { trustLan: true, password: undefined, client: "lan", needsBearer: false },
    { trustLan: true, password: undefined, client: "public", needsBearer: true },
    // trustLan off: only loopback is open.
    { trustLan: false, password: undefined, client: "loopback", needsBearer: false },
    { trustLan: false, password: undefined, client: "lan", needsBearer: true },
    { trustLan: false, password: undefined, client: "public", needsBearer: true },
    // A password is the opt-in lock for everyone, whatever trustLan says.
    { trustLan: true, password: CORRECT_PASSWORD_HASH, client: "loopback", needsBearer: true },
    { trustLan: true, password: CORRECT_PASSWORD_HASH, client: "lan", needsBearer: true },
    { trustLan: true, password: CORRECT_PASSWORD_HASH, client: "public", needsBearer: true },
    { trustLan: false, password: CORRECT_PASSWORD_HASH, client: "loopback", needsBearer: true },
    { trustLan: false, password: CORRECT_PASSWORD_HASH, client: "lan", needsBearer: true },
    { trustLan: false, password: CORRECT_PASSWORD_HASH, client: "public", needsBearer: true },
  ];

  test.each(MATRIX)(
    "trustLan=$trustLan password=$password client=$client -> needsBearer=$needsBearer",
    async ({ trustLan, password, client, needsBearer }) => {
      const auth = { password, access: policyFor(trustLan) };
      const req = requestFrom(SOCKETS[client]);
      expect(requestNeedsBearer(auth, req)).toBe(needsBearer);
      const withoutToken = await authorizeBearerAsync(auth, req, null);
      expect(withoutToken.ok).toBe(!needsBearer);
      if (password) {
        expect(await authorizeBearerAsync(auth, req, "correct-password")).toEqual({ ok: true });
        expect(await authorizeBearerAsync(auth, req, "wrong")).toEqual({
          ok: false,
          reason: "invalid_token",
        });
      } else if (needsBearer) {
        // Unclaimed and no password: nothing can authenticate yet.
        expect(withoutToken).toEqual({ ok: false, reason: "unclaimed" });
      }
    },
  );

  test("a LAN client behind a trusted proxy is classified by its forwarded address", () => {
    const trusting = { password: undefined, access: policyFor(true) };
    const req = requestFrom("127.0.0.1", "192.168.1.10");
    expect(trusting.access.clientLocality(req)).toBe("lan");
    expect(trusting.access.isLoopbackClient(req)).toBe(false);
    expect(requestNeedsBearer(trusting, req)).toBe(false);
    expect(requestNeedsBearer({ password: undefined, access: policyFor(false) }, req)).toBe(true);
  });
});
