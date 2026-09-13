import { afterEach, expect, it, vi } from "vitest";
import { fetchReleaseDescriptor } from "./release-descriptor.js";

afterEach(() => vi.unstubAllGlobals());

it("falls back only for a missing descriptor, not network or malformed metadata", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(new Response("missing", { status: 404 }));
  await expect(
    fetchReleaseDescriptor("https://example.test/electron-release.json"),
  ).resolves.toBeNull();
  fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await expect(
    fetchReleaseDescriptor("https://example.test/electron-release.json"),
  ).rejects.toThrow("503");
  fetcher.mockResolvedValueOnce(new Response("invalid JSON", { status: 200 }));
  await expect(
    fetchReleaseDescriptor("https://example.test/electron-release.json"),
  ).rejects.toThrow();
  fetcher.mockRejectedValueOnce(new Error("offline"));
  await expect(
    fetchReleaseDescriptor("https://example.test/electron-release.json"),
  ).rejects.toThrow("offline");
});
