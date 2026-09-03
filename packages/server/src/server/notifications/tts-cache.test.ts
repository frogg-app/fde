import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTtsCache } from "./tts-cache.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fde-tts-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function wav(size: number): Buffer {
  return Buffer.alloc(size, 1);
}

describe("createTtsCache", () => {
  it("stores audio under a hashed name with the extension of its mime type", async () => {
    const cache = createTtsCache({ dir });
    await cache.put("alert/1", { bytes: wav(10), mimeType: "audio/wav" });
    const names = await readdir(dir);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[0-9a-f]{64}\.wav$/);
    expect(await cache.get("alert/1")).toEqual({ bytes: wav(10), mimeType: "audio/wav" });
    expect(await cache.get("alert/2")).toBeNull();
  });

  it("evicts the least recently used entries once the byte cap is exceeded", async () => {
    let clock = 1_000_000;
    const cache = createTtsCache({ dir, maxBytes: 25, now: () => (clock += 1000) });
    await cache.put("a", { bytes: wav(10), mimeType: "audio/wav" });
    await cache.put("b", { bytes: wav(10), mimeType: "audio/wav" });
    expect(await cache.get("a")).not.toBeNull();
    await cache.put("c", { bytes: wav(10), mimeType: "audio/mpeg" });

    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("a")).toEqual({ bytes: wav(10), mimeType: "audio/wav" });
    expect(await cache.get("c")).toEqual({ bytes: wav(10), mimeType: "audio/mpeg" });
    expect(await cache.totalBytes()).toBe(20);
    expect(await readdir(dir)).toHaveLength(2);
  });

  it("rebuilds its index from the directory after a restart", async () => {
    const first = createTtsCache({ dir });
    await first.put("persisted", { bytes: wav(4), mimeType: "audio/mpeg" });

    const second = createTtsCache({ dir });
    expect(await second.get("persisted")).toEqual({ bytes: wav(4), mimeType: "audio/mpeg" });
    expect(await second.totalBytes()).toBe(4);
  });

  it("replaces an entry written under the same id", async () => {
    const cache = createTtsCache({ dir });
    await cache.put("same", { bytes: wav(3), mimeType: "audio/wav" });
    await cache.put("same", { bytes: wav(6), mimeType: "audio/mpeg" });
    expect(await cache.get("same")).toEqual({ bytes: wav(6), mimeType: "audio/mpeg" });
    expect(await readdir(dir)).toHaveLength(1);
  });
});
