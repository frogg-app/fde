import { describe, expect, it } from "vitest";
import { MAX_FILE_SIZE_BYTES, readBrowserFileBytes, readAttachmentSelection } from "./file-size";

describe("attachment pre-read size limit", () => {
  it("rejects a gigabyte file without requesting its contents", async () => {
    let reads = 0;
    const file = {
      name: "trace.zip",
      size: 1024 ** 3,
      async arrayBuffer() {
        reads += 1;
        throw new Error("Oversized contents must never be read");
      },
    };
    await expect(readBrowserFileBytes(file)).rejects.toMatchObject({
      name: "AttachmentSizeError",
      fileName: "trace.zip",
    });
    expect(reads).toBe(0);
  });

  it("reads ordinary files intact", async () => {
    const file = new File(["diagnostic metadata"], "capture-info.json");
    expect(await readBrowserFileBytes(file)).toEqual(
      new TextEncoder().encode("diagnostic metadata"),
    );
  });

  it("accepts metadata at the existing limit without allocating a limit-sized fixture", async () => {
    const bytes = new Uint8Array([1, 2]);
    const file = {
      name: "boundary.bin",
      size: MAX_FILE_SIZE_BYTES,
      arrayBuffer: async () => bytes.buffer,
    };
    expect(await readBrowserFileBytes(file)).toEqual(bytes);
  });
});

describe("attachment selection preflight", () => {
  it("rejects an oversized later selection before reading any browser or native file", async () => {
    let reads = 0;
    const readBytes = async () => {
      reads++;
      return new Uint8Array([1]);
    };
    await expect(
      readAttachmentSelection([
        { name: "small.txt", size: 1, readBytes },
        { name: "large.zip", size: MAX_FILE_SIZE_BYTES + 1, readBytes },
      ]),
    ).rejects.toMatchObject({ fileName: "large.zip" });
    expect(reads).toBe(0);
  });
  it("reads valid selections in order and preserves read failures", async () => {
    const failure = new Error("file unavailable");
    await expect(
      readAttachmentSelection([
        {
          name: "native.txt",
          size: 1,
          readBytes: async () => {
            throw failure;
          },
        },
      ]),
    ).rejects.toBe(failure);
    expect(
      await readAttachmentSelection([
        { name: "a.txt", size: 1, readBytes: async () => new Uint8Array([1]) },
        { name: "b.txt", size: 2, readBytes: async () => new Uint8Array([2, 3]) },
      ]),
    ).toEqual([new Uint8Array([1]), new Uint8Array([2, 3])]);
  });
});
