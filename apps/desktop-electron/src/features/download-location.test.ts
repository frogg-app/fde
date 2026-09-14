import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDownloadSavePath } from "./download-location";

const root = path.resolve("/downloads");
const isDirectory = (candidate: string) => candidate === root;

describe("resolveDownloadSavePath", () => {
  it("leaves the Save As dialog in place when asking every time", () => {
    expect(
      resolveDownloadSavePath(
        { mode: "ask", directory: root, defaultDirectory: root },
        "a.txt",
        () => false,
        isDirectory,
      ),
    ).toBeNull();
  });

  it("saves into the chosen directory, falling back to the platform default", () => {
    expect(
      resolveDownloadSavePath(
        { mode: "directory", directory: null, defaultDirectory: root },
        "a.txt",
        () => false,
        isDirectory,
      ),
    ).toBe(path.join(root, "a.txt"));
  });

  it("numbers the file when the name is taken and strips path segments", () => {
    const taken = new Set([path.join(root, "a.txt"), path.join(root, "a (1).txt")]);
    expect(
      resolveDownloadSavePath(
        { mode: "directory", directory: root, defaultDirectory: "" },
        "../../a.txt",
        (candidate) => taken.has(candidate),
        isDirectory,
      ),
    ).toBe(path.join(root, "a (2).txt"));
  });

  it("asks when the chosen directory no longer exists", () => {
    expect(
      resolveDownloadSavePath(
        { mode: "directory", directory: path.resolve("/gone"), defaultDirectory: root },
        "a.txt",
        () => false,
        isDirectory,
      ),
    ).toBeNull();
  });
});
