import { describe, expect, test } from "vitest";
import {
  copySizedAttachmentFile,
  readSizedAttachmentFile,
  MAX_ATTACHMENT_FILE_BYTES,
  type AttachmentFileAccess,
} from "./attachment-file-access.js";

class FakeFileAccess implements AttachmentFileAccess {
  size = 1024 ** 3;
  reads = 0;
  targets = 0;
  closed = 0;
  removed = false;
  written = 0;
  contents = Buffer.from("report");
  remaining = this.contents.length;
  failure: Error | null = null;
  async openSource() {
    return {
      stat: async () => {
        if (this.failure) throw this.failure;
        return { size: this.size, isFile: () => true };
      },
      read: async (maxBytes: number) => {
        this.reads++;
        const length = Math.min(maxBytes, this.remaining);
        this.remaining -= length;
        if (length <= this.contents.length) return this.contents.subarray(0, length);
        return Buffer.alloc(length);
      },
      close: async () => {
        this.closed++;
      },
    };
  }
  async openTarget() {
    this.targets++;
    return {
      write: async (bytes: Buffer) => {
        this.written += bytes.length;
      },
      close: async () => {
        this.closed++;
      },
    };
  }
  async remove() {
    this.removed = true;
  }
}

const copy = { source: "source", target: "managed" };

describe("native attachment size boundary", () => {
  test("rejects oversized source before opening or replacing managed storage", async () => {
    const access = new FakeFileAccess();
    await expect(copySizedAttachmentFile(copy, access)).rejects.toThrow("ATTACHMENT_TOO_LARGE:");
    expect(access.targets).toBe(0);
    expect(access.reads).toBe(0);
    expect(access.closed).toBe(1);
  });
  test("rejects oversized managed files before reading their bytes", async () => {
    const access = new FakeFileAccess();
    await expect(readSizedAttachmentFile("managed", access)).rejects.toThrow(
      "ATTACHMENT_TOO_LARGE:",
    );
    expect(access.reads).toBe(0);
    expect(access.closed).toBe(1);
  });
  test("accepts boundary metadata and returns normal bytes intact", async () => {
    const access = new FakeFileAccess();
    access.size = MAX_ATTACHMENT_FILE_BYTES;
    expect(await copySizedAttachmentFile(copy, access)).toBe(6);
    expect(access.written).toBe(6);
    access.remaining = 6;
    expect(await readSizedAttachmentFile("managed", access)).toEqual(Buffer.from("report"));
  });
  test("bounds a growing source and removes the partial copy", async () => {
    const access = new FakeFileAccess();
    access.size = 1;
    access.remaining = 1024 ** 3;
    await expect(copySizedAttachmentFile(copy, access)).rejects.toThrow("ATTACHMENT_TOO_LARGE:");
    expect(access.written).toBe(MAX_ATTACHMENT_FILE_BYTES);
    expect(access.removed).toBe(true);
    expect(access.closed).toBe(2);
    expect(access.remaining).toBe(1024 ** 3 - MAX_ATTACHMENT_FILE_BYTES - 1);
  });
  test("preserves filesystem failures and closes the source", async () => {
    const access = new FakeFileAccess();
    const failure = new Error("permission denied");
    access.failure = failure;
    await expect(readSizedAttachmentFile("managed", access)).rejects.toBe(failure);
    await expect(copySizedAttachmentFile(copy, access)).rejects.toBe(failure);
    expect(access.closed).toBe(2);
  });
});
