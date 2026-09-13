import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { root, type BrandBuild } from "./resolve.mjs";

interface Owner {
  pid: number;
  fingerprint: string;
  selected: string;
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
async function owner(file: string): Promise<Owner | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
export async function assertBuildAvailable(build: BrandBuild): Promise<void> {
  const file = path.join(root, ".generated/branding-build.lock/owner.json");
  const active = await owner(file);
  if (active && alive(active.pid) && active.fingerprint !== build.fingerprint) {
    throw new Error(
      `A build for ${active.selected} is active in this worktree. Use another worktree for ${build.selected}.`,
    );
  }
}
export async function acquireLock(
  kind: "prepare" | "build",
  build: BrandBuild,
): Promise<() => Promise<void>> {
  const dir = path.join(root, `.generated/branding-${kind}.lock`);
  await mkdir(path.dirname(dir), { recursive: true });
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      await mkdir(dir);
      await writeFile(
        path.join(dir, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          fingerprint: build.fingerprint,
          selected: build.selected,
        }),
      );
      return () => rm(dir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const active = await owner(path.join(dir, "owner.json"));
      if (active && !alive(active.pid)) {
        await rm(dir, { recursive: true, force: true });
        continue;
      }
      if (active && active.fingerprint !== build.fingerprint)
        throw new Error(
          `Another brand is being ${kind === "build" ? "built" : "prepared"}; use a separate worktree.`,
          { cause: error },
        );
      // Nested build entrypoints inherit the owner PID; independent builds still serialize.
      if (kind === "build" && active && String(active.pid) === process.env.FROGG_BRAND_BUILD_OWNER)
        return async () => {};
      await delay(100);
    }
  }
  throw new Error(
    `Timed out waiting for branding ${kind}. Check ${dir}; remove an abandoned lock only after its build has stopped.`,
  );
}
