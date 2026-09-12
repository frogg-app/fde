import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { getExecutionServiceStatus, stopExecutionService } from "./client.js";
import { pidLockInfoSchema } from "../pid-lock.js";

interface Supervisor {
  process: ChildProcess;
  exited: Promise<void>;
  output(): string;
}

function startSupervisor(home: string, enable: boolean): Supervisor {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FDE_HOME: home,
    PASEO_HOME: home,
    PASEO_LISTEN: "127.0.0.1:0",
    PASEO_NODE_ENV: "development",
    PASEO_NODE_INSPECT: "0",
    PASEO_RELAY_ENABLED: "false",
  };
  delete env.PASEO_SUPERVISED;
  delete env.FDE_EXECUTION_SERVICE;
  if (enable) env.FDE_EXECUTION_SERVICE = "1";
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("../../../scripts/supervisor-entrypoint.ts", import.meta.url)),
      "--dev",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  return { process: child, exited, output: () => output };
}

async function connectSupervisor(home: string, supervisor: Supervisor): Promise<DaemonClient> {
  let listen: string | null = null;
  await expect
    .poll(
      async () => {
        if (supervisor.process.exitCode !== null || supervisor.process.signalCode !== null) {
          throw new Error(`Supervisor exited before readiness: ${supervisor.output()}`);
        }
        const raw = await readFile(path.join(home, "paseo.pid"), "utf8").catch(() => "null");
        const parsed = pidLockInfoSchema.safeParse(JSON.parse(raw));
        listen =
          parsed.success && parsed.data.pid === supervisor.process.pid ? parsed.data.listen : null;
        return listen;
      },
      { timeout: 60_000, interval: 100 },
    )
    .toEqual(expect.any(String));
  const client = new DaemonClient({ url: `ws://${listen}/ws`, reconnect: { enabled: false } });
  await client.connect();
  return client;
}

async function stopSupervisor(supervisor: Supervisor): Promise<void> {
  if (supervisor.process.exitCode !== null || supervisor.process.signalCode !== null) return;
  supervisor.process.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      supervisor.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Supervisor failed to stop: ${supervisor.output()}`)),
          20_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("supervisor shutdown preserves execution and a later launch attaches without the opt-in flag", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fde-supervised-acceptance-"));
  const supervisors: Supervisor[] = [];
  const clients: DaemonClient[] = [];
  try {
    const first = startSupervisor(home, true);
    supervisors.push(first);
    const client = await connectSupervisor(home, first);
    clients.push(client);
    const runtime = await getExecutionServiceStatus(home);
    expect(runtime?.pid).toEqual(expect.any(Number));
    const agent = await client.createAgent({
      provider: "mock",
      cwd: home,
      title: "Retained supervised permission",
      model: "ten-second-stream",
    });
    await client.sendMessage(agent.id, "Emit a synthetic plan approval");
    const waiting = await client.waitForAgentUpsert(
      agent.id,
      (state) => state.pendingPermissions.length === 1,
    );
    await stopSupervisor(first);
    expect(await getExecutionServiceStatus(home)).toMatchObject({
      pid: runtime!.pid,
      instanceId: runtime!.instanceId,
      residentAgentCount: 1,
    });
    const replacement = startSupervisor(home, false);
    supervisors.push(replacement);
    const reconnected = await connectSupervisor(home, replacement);
    clients.push(reconnected);
    const retained = await reconnected.fetchAgent(agent.id);
    expect(retained?.agent.pendingPermissions).toEqual(waiting.pendingPermissions);
    expect(retained?.agent.activeTurn).toEqual(waiting.activeTurn);
    expect(await getExecutionServiceStatus(home)).toMatchObject({
      pid: runtime!.pid,
      instanceId: runtime!.instanceId,
    });
    await reconnected.respondToPermission(agent.id, waiting.pendingPermissions[0].id, {
      behavior: "allow",
    });
    await reconnected.waitForAgentUpsert(agent.id, (state) => state.status === "idle");
    await reconnected.shutdownServer();
    await expect.poll(() => replacement.process.exitCode, { timeout: 10_000 }).toBe(0);
    expect(await getExecutionServiceStatus(home)).toMatchObject({ pid: runtime!.pid });
    expect(await stopExecutionService({ home, force: true })).toEqual({ stopped: true });
    expect(await getExecutionServiceStatus(home)).toBeNull();
  } finally {
    for (const client of clients) await client.close();
    for (const supervisor of supervisors) await stopSupervisor(supervisor);
    await stopExecutionService({ home, force: true });
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);
