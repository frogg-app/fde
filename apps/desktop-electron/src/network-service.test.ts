import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeIdentity } from "./network-service.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

async function serve(handler: Parameters<typeof createServer>[0]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/identity`;
}

describe("native network identity probes", () => {
  it("returns JSON plus HTTP failure status without hiding the response", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "starting" }));
    });
    expect(await probeIdentity(url)).toEqual({
      status: 503,
      body: { status: "starting" },
    });
  });

  it("returns null for non-JSON health responses", async () => {
    const url = await serve((_request, response) => response.end("ready"));
    expect(await probeIdentity(url)).toEqual({ status: 200, body: null });
  });

  it("rejects redirects and oversized identity bodies", async () => {
    const redirect = await serve((_request, response) => {
      response.writeHead(302, { location: "http://example.com/" });
      response.end();
    });
    await expect(probeIdentity(redirect)).rejects.toThrow();
    const oversized = await serve((_request, response) => response.end("x".repeat(300 * 1024)));
    await expect(probeIdentity(oversized)).rejects.toThrow("exceeds 256 KiB");
  });
});
