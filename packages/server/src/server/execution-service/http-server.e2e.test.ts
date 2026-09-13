import { once } from "node:events";
import { request } from "node:http";
import { connect } from "node:net";
import { afterEach, expect, test } from "vitest";
import { createExecutionHttpServer } from "./http-server.js";

const servers: ReturnType<typeof createExecutionHttpServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("invalid forwarding cannot reach any HTTP or upgrade authorization listener", async () => {
  let httpRequests = 0;
  let upgrades = 0;
  const server = createExecutionHttpServer(
    (_req, res) => {
      httpRequests++;
      res.end("unexpected");
    },
    { token: "private-token" },
  );
  servers.push(server);
  server.on("upgrade", () => {
    upgrades++;
  });
  server.on("upgrade", () => {
    upgrades++;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP listener");
  const response = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: address.port,
        headers: { "x-frogg-execution-token": "forged", "x-frogg-execution-peer": "127.0.0.1" },
      },
      (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      },
    );
    req.once("error", reject);
    req.end();
  });
  expect(response).toBe(403);
  const socket = connect(address.port, "127.0.0.1");
  await once(socket, "connect");
  let text = "";
  socket.on("data", (chunk) => {
    text += chunk.toString();
  });
  socket.write(
    "GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nx-frogg-execution-token: forged\r\nx-frogg-execution-peer: 127.0.0.1\r\n\r\n",
  );
  await once(socket, "close");
  expect(text).toContain("403 Forbidden");
  expect(httpRequests).toBe(0);
  expect(upgrades).toBe(0);
});
