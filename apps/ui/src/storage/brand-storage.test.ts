import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock("@frogg/branding", () => ({ brand: { storagePrefix: "com.acme.studio:" } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => state.rows.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      state.rows.set(key, value);
    },
    removeItem: async (key: string) => {
      state.rows.delete(key);
    },
    getAllKeys: async () => [...state.rows.keys()],
    multiGet: async (keys: string[]) => keys.map((key) => [key, state.rows.get(key) ?? null]),
    multiRemove: async (keys: string[]) => {
      for (const key of keys) state.rows.delete(key);
    },
  },
}));
import storage from "./brand-storage";

describe("brand storage", () => {
  beforeEach(() => {
    state.rows.clear();
    state.rows.set("@frogg:settings", "official");
    state.rows.set("com.other.studio:@frogg:settings", "other");
  });
  it("reads and writes only this product's key namespace", async () => {
    expect(await storage.getItem("@frogg:settings")).toBeNull();
    await storage.setItem("@frogg:settings", "custom");
    expect(state.rows.get("@frogg:settings")).toBe("official");
    expect(await storage.getItem("@frogg:settings")).toBe("custom");
    expect(await storage.getAllKeys()).toEqual(["@frogg:settings"]);
    expect(await storage.multiGet(["@frogg:settings"])).toEqual([["@frogg:settings", "custom"]]);
  });
  it("cache cleanup cannot delete Frogg or another brand", async () => {
    await storage.setItem("@frogg:settings", "custom");
    await storage.multiRemove(await storage.getAllKeys());
    expect([...state.rows.values()]).toEqual(["official", "other"]);
  });
});
