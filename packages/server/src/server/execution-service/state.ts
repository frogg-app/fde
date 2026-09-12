import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pidLockInfoSchema } from "../pid-lock.js";
import { setTimeout as delay } from "node:timers/promises";
import { executionDescriptorSchema, type ExecutionServiceDescriptor } from "./protocol.js";

export function executionDirectory(home: string): string {
  return path.join(home, "execution-service");
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function prepareExecutionDirectory(home: string): Promise<string> {
  const directory = executionDirectory(home);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}

export async function readExecutionDescriptor(
  home: string,
): Promise<ExecutionServiceDescriptor | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(executionDirectory(home), "runtime.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return executionDescriptorSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(
      "Execution service descriptor is invalid or uses an incompatible protocol; refusing to start a second runtime",
    );
  }
}

export async function publishExecutionDescriptor(
  home: string,
  descriptor: ExecutionServiceDescriptor,
): Promise<void> {
  const directory = await prepareExecutionDirectory(home);
  const temporary = path.join(directory, `runtime-${descriptor.instanceId}.tmp`);
  await writeFile(temporary, JSON.stringify(descriptor), { mode: 0o600, flag: "wx" });
  await rename(temporary, path.join(directory, "runtime.json"));
}

export async function removeExecutionDescriptor(home: string, instanceId: string): Promise<void> {
  const current = await readExecutionDescriptor(home);
  if (current?.instanceId === instanceId) {
    await unlink(path.join(executionDirectory(home), "runtime.json")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  }
}

/** A live unpublished owner is initializing, not permission to create a second writer. */
export async function hasLiveExecutionOwner(home: string): Promise<boolean> {
  const filename = path.join(executionDirectory(home), "fde.pid");
  for (let attempt = 0; attempt < 10; attempt++) {
    let raw: string;
    try {
      raw = await readFile(filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    try {
      return isProcessAlive(pidLockInfoSchema.parse(JSON.parse(raw)).pid);
    } catch {
      if (attempt === 9)
        throw new Error(
          "Execution service owner file is invalid; refusing a second storage writer",
        );
      await delay(50);
    }
  }
  return false;
}
