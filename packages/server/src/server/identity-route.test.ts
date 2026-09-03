import express from "express";
import http from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, test } from "vitest";

import {
  createIdentityPreflightHandler,
  createIdentityRouteHandler,
  describeDaemonIdentity,
} from "./identity-route.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function listen(app: express.Application): Promise<number> {
  const server = http.createServer(app);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

describe("GET /api/identity", () => {
  test("describes the daemon and whether pairing is still required", () => {
    let claimed = false;
    const deps = {
      serverId: "srv_test",
      version: "1.2.3",
      hostname: () => "devbox",
      listen: () => "0.0.0.0:9999",
      isClaimed: () => claimed,
    };
    expect(describeDaemonIdentity(deps)).toEqual({
      product: "fde",
      serverId: "srv_test",
      hostname: "devbox",
      version: "1.2.3",
      listen: "0.0.0.0:9999",
      pairingRequired: true,
    });
    claimed = true;
    expect(describeDaemonIdentity(deps).pairingRequired).toBe(false);
  });

  test("serves JSON with no-store caching", async () => {
    const app = express();
    app.get(
      "/api/identity",
      createIdentityRouteHandler({
        serverId: "srv_test",
        version: "0.0.0",
        hostname: () => "devbox",
        listen: () => null,
        isClaimed: () => false,
      }),
    );
    const port = await listen(app);
    const response = await fetch(`http://127.0.0.1:${port}/api/identity`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-private-network")).toBe("true");
    expect(await response.json()).toEqual({
      product: "fde",
      serverId: "srv_test",
      hostname: "devbox",
      version: "0.0.0",
      listen: null,
      pairingRequired: true,
    });
  });

  test("answers the private-network preflight for any origin", async () => {
    const app = express();
    app.options("/api/identity", createIdentityPreflightHandler());
    const port = await listen(app);
    const response = await fetch(`http://127.0.0.1:${port}/api/identity`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://tauri.localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-private-network")).toBe("true");
  });
});
