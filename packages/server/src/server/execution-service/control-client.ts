import { request } from "node:http";
import {
  executionStatusSchema,
  type ExecutionServiceDescriptor,
  type ExecutionServiceStatus,
} from "./protocol.js";

/** Control traffic never follows redirects or sends the capability to public endpoints. */
export async function executionControlRequest(
  descriptor: ExecutionServiceDescriptor,
  pathname: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port: descriptor.controlPort,
        path: pathname,
        method: data === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${descriptor.token}`,
          "x-frogg-execution-instance": descriptor.instanceId,
          ...(data === undefined
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(data) }),
        },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 64 * 1024) {
            req.destroy(new Error("Execution control response exceeds limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          let result: unknown;
          try {
            result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            reject(new Error("Invalid execution control response"));
            return;
          }
          if (res.statusCode !== 200) {
            const message =
              typeof result === "object" && result !== null && "error" in result
                ? String(result.error)
                : `HTTP ${res.statusCode}`;
            reject(new Error(`Execution service: ${message}`));
            return;
          }
          resolve(result);
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("Execution service control request timed out")),
      3000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(data);
  });
}

export async function readExecutionStatus(
  descriptor: ExecutionServiceDescriptor,
): Promise<ExecutionServiceStatus> {
  const status = executionStatusSchema.parse(await executionControlRequest(descriptor, "/status"));
  if (
    status.instanceId !== descriptor.instanceId ||
    status.pid !== descriptor.pid ||
    status.port !== descriptor.port ||
    status.version !== descriptor.version
  ) {
    throw new Error("Execution service identity does not match its descriptor; refusing to attach");
  }
  return status;
}
