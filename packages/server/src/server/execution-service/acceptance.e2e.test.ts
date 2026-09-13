import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import {
  ensureExecutionService,
  getExecutionServiceStatus,
  stopExecutionService,
} from "./client.js";
import { createExecutionGateway } from "./gateway.js";
import type { ExecutionServiceDescriptor } from "./protocol.js";

const homes: string[] = [];
const clients: DaemonClient[] = [];
const gateways: ReturnType<typeof createExecutionGateway>[] = [];

async function prepareRuntime() {
  const home = await mkdtemp(path.join(tmpdir(), "frogg-execution-acceptance-"));
  homes.push(home);
  const options = {
    home,
    version: "acceptance-1",
    workerEntry: fileURLToPath(new URL("./worker.ts", import.meta.url)),
    execArgv: ["--import", "tsx"],
    env: {
      ...process.env,
      FROGG_HOME: home,
      FROGG_NODE_ENV: "development",
      FROGG_RELAY_ENABLED: "false",
      FROGG_LISTEN: "127.0.0.1:0",
      FROGG_SUPERVISED: "0",
    },
  };
  return { home, options };
}

async function startRuntime() {
  const { home, options } = await prepareRuntime();
  try {
    return { home, options, runtime: await ensureExecutionService(options) };
  } catch (error) {
    const log = await readFile(path.join(home, "execution-service", "execution.log"), "utf8").catch(
      () => "No worker log",
    );
    throw new Error(`${String(error)}\n${log}`, { cause: error });
  }
}

async function connectGateway(runtime: ExecutionServiceDescriptor) {
  const gateway = createExecutionGateway({ listen: "127.0.0.1:0", runtime });
  gateways.push(gateway);
  await gateway.start();
  const target = gateway.getListenTarget();
  if (target.type !== "tcp") throw new Error("Acceptance gateway must bind TCP");
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${target.port}/ws`,
    reconnect: { enabled: false },
  });
  clients.push(client);
  await client.connect();
  return { gateway, client };
}

async function timeline(client: DaemonClient, agentId: string) {
  return client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 0,
    projection: "canonical",
  });
}

function assistantText(result: Awaited<ReturnType<typeof timeline>>) {
  return result.entries
    .flatMap((entry) => (entry.item.type === "assistant_message" ? [entry.item.text] : []))
    .join("");
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const gateway of gateways.splice(0)) await gateway.stop();
  for (const home of homes.splice(0)) {
    await stopExecutionService({ home, force: true });
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);

test("retains the same running turn across gateway replacement without replaying its prompt", async () => {
  const { home, runtime, options } = await startRuntime();
  const first = await connectGateway(runtime);
  const agent = await first.client.createAgent({
    provider: "mock",
    cwd: home,
    title: "Survives gateway replacement",
    model: "ten-second-stream",
  });
  const prompt = "Continue this exact turn while the gateway is replaced";
  await first.client.sendMessage(agent.id, prompt);
  const running = await first.client.waitForAgentUpsert(
    agent.id,
    (state) => state.status === "running",
  );
  expect(running.activeTurn?.turnId).toEqual(expect.any(String));
  await expect
    .poll(async () => assistantText(await timeline(first.client, agent.id)).length)
    .toBeGreaterThan(0);
  const before = assistantText(await timeline(first.client, agent.id));

  const observer = new DaemonClient({
    url: `ws://127.0.0.1:${runtime.port}/ws`,
    reconnect: { enabled: false },
  });
  clients.push(observer);
  await observer.connect();
  await first.gateway.stop();
  await expect
    .poll(async () => assistantText(await timeline(observer, agent.id)).length)
    .toBeGreaterThan(before.length);
  expect((await observer.fetchAgent(agent.id))?.agent.activeTurn).toEqual(running.activeTurn);
  const retained = await ensureExecutionService(options);
  expect(retained).toEqual(runtime);
  expect(await getExecutionServiceStatus(home)).toMatchObject({
    pid: runtime.pid,
    instanceId: runtime.instanceId,
    residentAgentCount: 1,
  });
  const second = await connectGateway(retained);
  const resumed = await second.client.fetchAgent(agent.id);
  expect(resumed?.agent.activeTurn).toEqual(running.activeTurn);
  await expect
    .poll(async () => assistantText(await timeline(second.client, agent.id)).length)
    .toBeGreaterThan(before.length);
  await second.client.waitForAgentUpsert(agent.id, (state) => state.status === "idle", 20_000);
  const completed = await timeline(second.client, agent.id);
  expect(assistantText(completed)).toContain("(end of synthetic stream)");
  expect(
    completed.entries
      .filter((entry) => entry.item.type === "user_message")
      .map((entry) => entry.item),
  ).toEqual([expect.objectContaining({ type: "user_message", text: prompt })]);
  await expect(stopExecutionService({ home })).rejects.toThrow(/resident|agent/i);
  expect(await getExecutionServiceStatus(home)).toMatchObject({
    pid: runtime.pid,
    residentAgentCount: 1,
  });
  expect(await stopExecutionService({ home, force: true })).toEqual({ stopped: true });
  expect(await getExecutionServiceStatus(home)).toBeNull();
}, 60_000);

test("retains a pending permission and resolves it through a replacement gateway", async () => {
  const { home, runtime } = await startRuntime();
  const first = await connectGateway(runtime);
  const agent = await first.client.createAgent({
    provider: "mock",
    cwd: home,
    title: "Permission survives replacement",
    model: "ten-second-stream",
  });
  await first.client.sendMessage(agent.id, "Emit a synthetic plan approval");
  const waiting = await first.client.waitForAgentUpsert(
    agent.id,
    (state) => state.pendingPermissions.length === 1,
  );
  const permission = waiting.pendingPermissions[0];
  await first.gateway.stop();
  const second = await connectGateway(runtime);
  const retained = await second.client.fetchAgent(agent.id);
  expect(retained?.agent.pendingPermissions).toEqual([permission]);
  expect(retained?.agent.activeTurn).toEqual(waiting.activeTurn);
  await second.client.respondToPermission(agent.id, permission.id, { behavior: "allow" });
  const finished = await second.client.waitForAgentUpsert(
    agent.id,
    (state) => state.status === "idle",
  );
  expect(finished.pendingPermissions).toEqual([]);
  expect(await getExecutionServiceStatus(home)).toMatchObject({
    pid: runtime.pid,
    instanceId: runtime.instanceId,
  });
}, 60_000);

test("concurrent discovery starts converge on one execution owner", async () => {
  const { home, options } = await prepareRuntime();
  const runtimes = await Promise.all(
    Array.from({ length: 4 }, () => ensureExecutionService(options)),
  );
  expect(runtimes).toEqual(Array(4).fill(runtimes[0]));
  expect(await getExecutionServiceStatus(home)).toMatchObject({
    pid: runtimes[0].pid,
    residentAgentCount: 0,
  });
}, 90_000);

test.each(["{bad-json", JSON.stringify({ protocolVersion: 999 })])(
  "fails closed on invalid execution descriptors: %s",
  async (descriptor) => {
    const { home, options } = await prepareRuntime();
    const directory = path.join(home, "execution-service");
    await mkdir(directory, { recursive: true });
    const descriptorPath = path.join(directory, "runtime.json");
    await writeFile(descriptorPath, descriptor);
    try {
      await expect(ensureExecutionService(options)).rejects.toThrow(/invalid|incompatible/i);
      await expect(getExecutionServiceStatus(home)).rejects.toThrow(/invalid|incompatible/i);
    } finally {
      await rm(descriptorPath);
    }
  },
);

test("refuses discovery and forced stop when a live owner cannot authenticate", async () => {
  const { home, options, runtime } = await startRuntime();
  const descriptorPath = path.join(home, "execution-service", "runtime.json");
  await writeFile(descriptorPath, JSON.stringify({ ...runtime, token: "invalid-token".repeat(4) }));
  try {
    await expect(ensureExecutionService(options)).rejects.toThrow();
    await expect(stopExecutionService({ home, force: true })).rejects.toThrow();
    expect(() => process.kill(runtime.pid, 0)).not.toThrow();
  } finally {
    await writeFile(descriptorPath, JSON.stringify(runtime));
  }
  expect(await getExecutionServiceStatus(home)).toMatchObject({
    pid: runtime.pid,
    instanceId: runtime.instanceId,
  });
}, 60_000);

test("runtime version upgrade retains resident execution and reports gateway and backend versions separately", async () => {
  const { home, options, runtime } = await startRuntime();
  const first = await connectGateway(runtime);
  const agent = await first.client.createAgent({
    provider: "mock",
    cwd: home,
    title: "Version retention",
    model: "ten-second-stream",
  });
  const retained = await ensureExecutionService({ ...options, version: "acceptance-2" });
  expect(retained).toEqual(runtime);
  expect((await first.client.fetchAgent(agent.id))?.agent.id).toBe(agent.id);
  const gateway = createExecutionGateway({
    listen: "127.0.0.1:0",
    runtime: retained,
    gatewayVersion: "acceptance-2",
  });
  gateways.push(gateway);
  await gateway.start();
  const target = gateway.getListenTarget();
  if (target?.type !== "tcp") throw new Error("Expected TCP gateway");
  const response = await fetch(`http://127.0.0.1:${target.port}/api/identity`);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-frogg-gateway-version")).toBe("acceptance-2");
  expect(response.headers.get("x-frogg-execution-version")).toBe("acceptance-1");
  expect(await response.json()).toMatchObject({ version: "acceptance-1" });
}, 60_000);

test("runtime version upgrade replaces an empty service before attaching", async () => {
  const { home, options, runtime } = await startRuntime();
  const replaced = await ensureExecutionService({ ...options, version: "acceptance-2" });
  expect(replaced.version).toBe("acceptance-2");
  expect(replaced.instanceId).not.toBe(runtime.instanceId);
  expect(replaced.pid).not.toBe(runtime.pid);
  expect(await getExecutionServiceStatus(home)).toMatchObject({
    version: "acceptance-2",
    residentAgentCount: 0,
  });
}, 60_000);
