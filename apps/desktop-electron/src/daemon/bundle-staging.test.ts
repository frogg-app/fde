import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { stageDaemonBundle } from "./bundle-staging.js";

const roots: string[] = [];
const identity = {
  version: "0.4.2",
  platform: "linux",
  arch: "x64",
  brand: { id: "frogg", applicationId: "app.frogg.frogg" },
};
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frogg-bundle-stage-"));
  roots.push(root);
  const source = path.join(root, "mount");
  const destination = path.join(root, "profile/daemon-bundles/0.4.2");
  const files = [
    "node/bin/node",
    "daemon/apps/cli/dist/index.js",
    "daemon/packages/server/dist/scripts/supervisor-entrypoint.js",
  ];
  for (const file of files) {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await writeFile(path.join(source, file), "fixture");
  }
  await writeFile(path.join(source, "manifest.json"), JSON.stringify(identity));
  return { source, destination, identity };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("keeps the Node daemon available after its AppImage mount disappears", async () => {
  const input = await fixture();
  await stageDaemonBundle(input);
  await rm(input.source, { recursive: true });
  await stageDaemonBundle(input);
  expect(await readFile(path.join(input.destination, "node/bin/node"), "utf8")).toBe("fixture");
  expect(await readdir(path.dirname(input.destination))).toEqual(["0.4.2"]);
});
it("does not publish a bundle belonging to another product", async () => {
  const input = await fixture();
  await writeFile(
    path.join(input.source, "manifest.json"),
    JSON.stringify({ ...identity, brand: { id: "other", applicationId: "other.app" } }),
  );
  await expect(stageDaemonBundle(input)).rejects.toThrow("identity mismatch");
  await expect(readFile(path.join(input.destination, "manifest.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("publishes one complete bundle when two launches stage concurrently", async () => {
  const input = await fixture();
  await Promise.all([stageDaemonBundle(input), stageDaemonBundle(input)]);
  expect(await readdir(path.dirname(input.destination))).toEqual(["0.4.2"]);
  expect(JSON.parse(await readFile(path.join(input.destination, "manifest.json"), "utf8"))).toEqual(
    identity,
  );
});

it("accepts Windows EPERM only after a complete matching bundle wins publication", async () => {
  const input = await fixture();
  await stageDaemonBundle(input, {
    rename: async (source, destination) => {
      await rename(source, destination);
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    },
  });
  expect(await readdir(path.dirname(input.destination))).toEqual(["0.4.2"]);
  expect(await readFile(path.join(input.destination, "node/bin/node"), "utf8")).toBe("fixture");
});

it("preserves a Windows permission failure when no bundle was published", async () => {
  const input = await fixture();
  const denied = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  await expect(
    stageDaemonBundle(input, {
      rename: async () => {
        throw denied;
      },
    }),
  ).rejects.toBe(denied);
  expect(await readdir(path.dirname(input.destination))).toEqual([]);
});
