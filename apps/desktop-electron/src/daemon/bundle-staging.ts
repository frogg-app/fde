import { cp, mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const Manifest = z.object({
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  brand: z.object({ id: z.string(), applicationId: z.string() }),
});
interface BundleIdentity {
  version: string;
  platform: string;
  arch: string;
  brand: { id: string; applicationId: string };
}
interface StageInput {
  source: string;
  destination: string;
  identity: BundleIdentity;
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function validate(root: string, expected: BundleIdentity): Promise<void> {
  const manifest = Manifest.parse(
    JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")),
  );
  if (JSON.stringify(manifest) !== JSON.stringify(Manifest.parse(expected))) {
    throw new Error(`Daemon bundle identity mismatch at ${root}`);
  }
  const nodePath = expected.platform === "win" ? "node/node.exe" : "node/bin/node";
  for (const file of [
    nodePath,
    "daemon/apps/cli/dist/index.js",
    "daemon/packages/server/dist/scripts/supervisor-entrypoint.js",
  ]) {
    if (!(await stat(path.join(root, file))).isFile())
      throw new Error(`Missing daemon bundle file: ${file}`);
  }
}
/** Keep detached AppImage daemons and installed CLI shims independent of the FUSE mount. */
export async function stageDaemonBundle(input: StageInput): Promise<void> {
  try {
    await stat(input.destination);
    await validate(input.destination, input.identity);
    return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await validate(input.source, input.identity);
  const parent = path.dirname(input.destination);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, ".install-"));
  try {
    await cp(input.source, temporary, { recursive: true, dereference: true });
    await validate(temporary, input.identity);
    try {
      await rename(temporary, input.destination);
    } catch (error) {
      const raced =
        error instanceof Error &&
        "code" in error &&
        ["EEXIST", "ENOTEMPTY"].includes(String(error.code));
      if (!raced) throw error;
      await validate(input.destination, input.identity);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
