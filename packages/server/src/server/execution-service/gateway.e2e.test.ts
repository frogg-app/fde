import { createServer, request, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createExecutionGateway } from "./gateway.js";
import { restoreExecutionRequest } from "./forwarding.js";

const token = "a".repeat(64);
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing TCP address");
  return address.port;
}
async function gateway(port: number) {
  const service = createExecutionGateway({
    listen: "127.0.0.1:0",
    gatewayVersion: "new",
    runtime: {
      token,
      port,
      controlPort: port,
      pid: process.pid,
      protocolVersion: 1,
      instanceId: "00000000-0000-4000-8000-000000000000",
      version: "old",
      startedAt: "test",
    },
  });
  await service.start();
  cleanup.push(() => service.stop());
  const target = service.getListenTarget();
  if (target?.type !== "tcp") throw new Error("Missing gateway TCP address");
  return { service, port: target.port };
}
async function get(port: number, headers: Record<string, string> = {}, localAddress = "127.0.0.1") {
  return await new Promise<{
    status: number | undefined;
    body: string;
    version: string | string[] | undefined;
  }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, headers, localAddress, agent: false }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () =>
        resolve({ status: res.statusCode, body, version: res.headers["x-fde-gateway-version"] }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

it("preserves HTTP identity and auth headers while replacing forged metadata", async () => {
  const port = await listen(
    createServer((req, res) => {
      const valid = restoreExecutionRequest(req, token);
      res.writeHead(valid ? 200 : 403).end(
        JSON.stringify({
          peer: req.socket.remoteAddress,
          headers: req.headers,
          privateHeaders: req.rawHeaders.filter((header) => header.startsWith("x-fde-execution-")),
        }),
      );
    }),
  );
  const front = await gateway(port);
  const headers = {
    host: "public.example",
    origin: "https://public.example",
    authorization: "Bearer user",
    "x-forwarded-for": "198.51.100.9",
    connection: "close",
  };
  const result = await get(
    front.port,
    {
      ...headers,
      "x-fde-execution-peer": "127.0.0.1",
      "x-fde-execution-token": token,
      "x-fde-execution-extra": "forged",
    },
    "127.0.0.2",
  );
  expect(result).toEqual({
    status: 200,
    version: "new",
    body: JSON.stringify({ peer: "127.0.0.2", headers, privateHeaders: [] }),
  });
});

it("rejects invalid, incomplete and non-loopback gateway claims", async () => {
  const port = await listen(
    createServer((req, res) =>
      res.writeHead(restoreExecutionRequest(req, token) ? 200 : 403).end(),
    ),
  );
  expect((await get(port)).status).toBe(200);
  const claims: Record<string, string>[] = [
    { "x-fde-execution-peer": "127.0.0.1" },
    { "x-fde-execution-peer": "127.0.0.1", "x-fde-execution-token": "wrong" },
    { "x-fde-execution-peer": "bad-address", "x-fde-execution-token": token },
    {
      "x-fde-execution-peer": "127.0.0.1",
      "x-fde-execution-token": token,
      "x-fde-execution-extra": "bad",
    },
  ];
  for (const headers of claims) expect((await get(port, headers)).status).toBe(403);
  expect(
    (
      await get(
        port,
        { "x-fde-execution-peer": "127.0.0.1", "x-fde-execution-token": token },
        "127.0.0.2",
      )
    ).status,
  ).toBe(403);
});

it("streams the response before the upload finishes", async () => {
  const port = await listen(
    createServer((req, res) => {
      restoreExecutionRequest(req, token);
      req.on("data", (chunk) => {
        res.write(chunk);
      });
      req.on("end", () => res.end());
    }),
  );
  const front = await gateway(port);
  const req = request({ host: "127.0.0.1", port: front.port, method: "POST" });
  req.write("first");
  const [response] = await once(req, "response");
  const [chunk] = await once(response, "data");
  expect(chunk.toString()).toBe("first");
  const ended = once(response, "end");
  req.end();
  await ended;
});

it("forwards WebSocket identity and messages and closes upgraded sockets on stop", async () => {
  const server = createServer();
  const ws = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!restoreExecutionRequest(req, token)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    ws.handleUpgrade(req, socket, head, (client) => {
      client.send(req.socket.remoteAddress);
      client.on("message", (message) => client.send(message));
    });
  });
  const port = await listen(server);
  const front = await gateway(port);
  const client = new WebSocket(`ws://127.0.0.1:${front.port}`, {
    localAddress: "127.0.0.2",
    headers: { "x-fde-execution-peer": "127.0.0.1" },
  });
  const [identity] = await once(client, "message");
  expect(identity.toString()).toBe("127.0.0.2");
  const reply = once(client, "message");
  client.send("working");
  expect((await reply)[0].toString()).toBe("working");
  const closed = once(client, "close");
  await front.service.stop();
  await closed;
  expect(front.service.getListenTarget()).toBe(null);
  ws.close();
});

it("returns an explicit upstream error after execution stops", async () => {
  const server = createServer();
  const port = await listen(server);
  const front = await gateway(port);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(await get(front.port)).toEqual({
    status: 502,
    body: "Execution service unavailable",
    version: "new",
  });
});

it("restores IPC and successive original peers on one keep-alive runtime connection", async () => {
  const { Agent } = await import("node:http");
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  cleanup.push(async () => agent.destroy());
  const port = await listen(
    createServer((req, res) => {
      res
        .writeHead(restoreExecutionRequest(req, token) ? 200 : 403)
        .end(req.socket.remoteAddress ?? "ipc");
    }),
  );
  async function peer(headers: Record<string, string>) {
    const req = request({ host: "127.0.0.1", port, agent, headers });
    req.end();
    const [res] = await once(req, "response");
    let body = "";
    for await (const chunk of res) body += chunk;
    return { status: res.statusCode, body };
  }
  expect(
    await peer({ "x-fde-execution-token": token, "x-fde-execution-peer": "198.51.100.2" }),
  ).toEqual({ status: 200, body: "198.51.100.2" });
  expect(await peer({ "x-fde-execution-token": token, "x-fde-execution-peer": "ipc" })).toEqual({
    status: 200,
    body: "ipc",
  });
  expect(await peer({})).toEqual({ status: 200, body: "127.0.0.1" });
});

it("rejects duplicated forwarding headers", async () => {
  const { connect } = await import("node:net");
  const port = await listen(
    createServer((req, res) => {
      res.writeHead(restoreExecutionRequest(req, token) ? 200 : 403).end();
    }),
  );
  const socket = connect(port, "127.0.0.1");
  socket.write(
    `GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-fde-execution-token: ${token}\r\nx-fde-execution-peer: ipc\r\nx-fde-execution-peer: ipc\r\n\r\n`,
  );
  const [chunk] = await once(socket, "data");
  expect(chunk.toString().split("\r\n")[0]).toBe("HTTP/1.1 403 Forbidden");
  socket.destroy();
});

it("preserves rejected upgrade authentication headers and body", async () => {
  const { connect } = await import("node:net");
  const server = createServer();
  server.on("upgrade", (_req, socket) => {
    socket.end(
      "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer\r\nContent-Length: 6\r\n\r\ndenied",
    );
  });
  const front = await gateway(await listen(server));
  const socket = connect(front.port, "127.0.0.1");
  socket.write(
    "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  );
  let response = "";
  for await (const chunk of socket) response += chunk;
  expect(response).toBe(
    "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer\r\nContent-Length: 6\r\nConnection: close\r\n\r\ndenied",
  );
});

it("cancels a streaming upstream request when its client disconnects", async () => {
  const server = createServer();
  const front = await gateway(await listen(server));
  const incoming = once(server, "request");
  const req = request({ host: "127.0.0.1", port: front.port, method: "POST" });
  req.on("error", () => {});
  req.write("partial upload");
  const [upstream] = await incoming;
  upstream.on("error", () => {});
  upstream.resume();
  const aborted = new Promise<void>((resolve) => upstream.once("aborted", resolve));
  req.destroy();
  await aborted;
  expect(upstream.aborted).toBe(true);
});

it("removes private credentials from an already-read distinct header view", async () => {
  const port = await listen(
    createServer((req, res) => {
      const distinct = req.headersDistinct;
      restoreExecutionRequest(req, token);
      res.end(
        JSON.stringify(Object.keys(distinct).filter((name) => name.startsWith("x-fde-execution-"))),
      );
    }),
  );
  const result = await get(port, { "x-fde-execution-token": token, "x-fde-execution-peer": "ipc" });
  expect(result.body).toBe("[]");
});
