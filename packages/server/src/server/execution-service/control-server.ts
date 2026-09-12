import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import type { ExecutionServiceDescriptor, ExecutionServiceStatus } from "./protocol.js";

interface ExecutionControlOptions {
  token: string;
  instanceId: string;
  status(): ExecutionServiceStatus;
  stop(force: boolean): void;
  acknowledge(sequence: number): void;
  setPublicListen(listen: string): void;
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function authenticated(req: IncomingMessage, options: ExecutionControlOptions): boolean {
  const supplied = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${options.token}`);
  return (
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected) &&
    req.headers["x-fde-execution-instance"] === options.instanceId
  );
}

async function readControlBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += data.length;
    if (bytes > 4096) throw new Error("Control request exceeds limit");
    chunks.push(data);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function createExecutionControlServer(options: ExecutionControlOptions): Promise<{
  port: number;
  close(): Promise<void>;
}> {
  const server = createServer((req, res) => {
    if (!authenticated(req, options)) {
      send(res, 403, { error: "Unauthorized execution control request" });
      return;
    }
    void (async () => {
      if (req.method === "GET" && req.url === "/status") {
        send(res, 200, options.status());
        return;
      }
      if (req.method === "POST" && req.url === "/stop") {
        const input = z
          .object({ force: z.boolean().default(false) })
          .strict()
          .parse(await readControlBody(req));
        options.stop(input.force);
        send(res, 200, { stopped: true });
        return;
      }
      if (req.method === "POST" && req.url === "/ack") {
        const input = z
          .object({ sequence: z.number().int().positive() })
          .strict()
          .parse(await readControlBody(req));
        options.acknowledge(input.sequence);
        send(res, 200, { acknowledged: true });
        return;
      }
      if (req.method === "POST" && req.url === "/gateway") {
        const input = z
          .object({ listen: z.string().min(1).max(2048) })
          .strict()
          .parse(await readControlBody(req));
        options.setPublicListen(input.listen);
        send(res, 200, { updated: true });
        return;
      }
      send(res, 404, { error: "Unknown execution control operation" });
    })().catch((error: unknown) => {
      if (!res.headersSent)
        send(res, 409, {
          error: error instanceof Error ? error.message : "Execution control failed",
        });
      else res.destroy();
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Execution control did not bind TCP");
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function publicExecutionStatus(
  descriptor: ExecutionServiceDescriptor,
  residentAgentCount: number,
  lifecycle: ExecutionServiceStatus["lifecycle"],
): ExecutionServiceStatus {
  const { token: _token, ...identity } = descriptor;
  return { ...identity, residentAgentCount, lifecycle };
}
