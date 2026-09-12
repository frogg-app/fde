import { createServer, request, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { parseListenString, type ListenTarget } from "../listen-target.js";
import { executionForwardingHeaders } from "./forwarding.js";
import type { ExecutionServiceDescriptor } from "./protocol.js";

interface ExecutionGatewayOptions {
  listen: string;
  gatewayVersion?: string;
  runtime: ExecutionServiceDescriptor;
}

export function createExecutionGateway({
  listen,
  runtime,
  gatewayVersion,
}: ExecutionGatewayOptions) {
  const target = parseListenString(listen);
  let bound: ListenTarget | null = null;
  const sockets = new Set<Duplex>();
  function track(socket: Duplex) {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  }
  function forward(req: IncomingMessage) {
    const upstream = request({
      hostname: "127.0.0.1",
      port: runtime.port,
      method: req.method,
      path: req.url,
      headers: executionForwardingHeaders(req, runtime.token),
      agent: false,
    });
    upstream.on("socket", track);
    req.once("aborted", () => upstream.destroy());
    req.once("error", () => upstream.destroy());
    return upstream;
  }
  const server = createServer((req, res) => {
    const upstream = forward(req);
    res.setHeader("x-fde-execution-version", runtime.version);
    if (gatewayVersion) res.setHeader("x-fde-gateway-version", gatewayVersion);
    upstream.on("response", (response) => {
      res.writeHead(response.statusCode ?? 502, {
        ...response.headers,
        "x-fde-execution-version": runtime.version,
        ...(gatewayVersion ? { "x-fde-gateway-version": gatewayVersion } : {}),
      });
      response.once("error", () => res.destroy());
      response.pipe(res);
    });
    upstream.once("error", () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end("Execution service unavailable");
    });
    res.once("close", () => upstream.destroy());
    res.once("error", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on("connection", track);
  server.on("upgrade", (req, socket, head) => {
    const upstream = forward(req);
    socket.once("error", () => upstream.destroy());
    socket.once("close", () => upstream.destroy());
    upstream.once("error", () => {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    upstream.on("upgrade", (response, peer, upstreamHead) => {
      track(peer);
      peer.once("error", () => socket.destroy());
      socket.once("error", () => peer.destroy());
      peer.once("close", () => socket.destroy());
      socket.once("close", () => peer.destroy());
      const headers = response.rawHeaders.reduce<string[]>((lines, value, index, all) => {
        if (index % 2 === 0) lines.push(`${value}: ${all[index + 1]}`);
        return lines;
      }, []);
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${headers.join("\r\n")}\r\n\r\n`,
      );
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      peer.pipe(socket).pipe(peer);
    });
    upstream.on("response", (response) => {
      const headers = response.rawHeaders.reduce<string[]>((lines, value, index, all) => {
        if (index % 2 === 0) lines.push(`${value}: ${all[index + 1]}`);
        return lines;
      }, []);
      // IncomingMessage has already decoded chunked framing; send a close-delimited body.
      const forwardedHeaders = headers.filter(
        (line) => !/^(transfer-encoding|connection):/i.test(line),
      );
      socket.write(
        `HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? "Bad Gateway"}\r\n${forwardedHeaders.join("\r\n")}\r\nConnection: close\r\n\r\n`,
      );
      response.once("error", () => socket.destroy());
      response.pipe(socket);
    });
    upstream.end();
  });
  return {
    async start(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        function ready() {
          server.removeListener("error", reject);
          resolve();
        }
        if (target.type === "tcp") server.listen(target.port, target.host, ready);
        else server.listen(target.path, ready);
      });
      const address = server.address();
      bound =
        target.type === "tcp" && address && typeof address !== "string"
          ? { ...target, port: address.port }
          : target;
    },
    async stop(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      bound = null;
    },
    getListenTarget(): ListenTarget | null {
      return bound;
    },
  };
}
