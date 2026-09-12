import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createExecutionGateway } from "./gateway.js";

// These local-resource tests exercise Unix filesystem sockets, including a crash-left inode.
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "fde-gateway-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const socketPath = path.join(directory, "daemon.sock");
  const gateway = createExecutionGateway({
    listen: `unix://${socketPath}`,
    runtime: {
      protocolVersion: 1,
      instanceId: "00000000-0000-4000-8000-000000000000",
      pid: process.pid,
      version: "test",
      startedAt: "test",
      port: 1,
      controlPort: 1,
      token: "a".repeat(64),
    },
  });
  cleanup.push(() => gateway.stop());
  return { socketPath, gateway };
}

it("reclaims a socket left by a crashed listener and rebinds after normal stop", async () => {
  const { socketPath, gateway } = await fixture();
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require("node:net").createServer().listen(process.argv[1], () => process.stdout.write("ready"))',
      socketPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  });
  await once(child.stdout, "data");
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  await gateway.start();
  expect(gateway.getListenTarget()).toEqual({ type: "socket", path: socketPath });
  const req = request({ socketPath });
  req.end();
  const [response] = await once(req, "response");
  response.resume();
  expect(response.statusCode).toBe(502);
  await gateway.stop();
  await gateway.start();
  expect(gateway.getListenTarget()).toEqual({ type: "socket", path: socketPath });
});

it("does not unlink another live listener", async () => {
  const { socketPath, gateway } = await fixture();
  const server = createServer((_req, res) => res.end("owner"));
  server.listen(socketPath);
  await once(server, "listening");
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await expect(gateway.start()).rejects.toThrow("Socket already has an active listener");
  const req = request({ socketPath });
  req.end();
  const [response] = await once(req, "response");
  let body = "";
  for await (const chunk of response) body += chunk;
  expect(body).toBe("owner");
});

it("does not replace a regular file at the configured socket path", async () => {
  const { socketPath, gateway } = await fixture();
  await writeFile(socketPath, "preserve");
  await expect(gateway.start()).rejects.toThrow("Refusing to replace non-socket listen path");
  expect(await readFile(socketPath, "utf8")).toBe("preserve");
});
