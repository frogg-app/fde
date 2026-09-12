import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CompanionMessageReceipts } from "./message-receipts.js";

it("retains accepted request IDs across a daemon restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fde-companion-receipts-"));
  try {
    const filePath = path.join(directory, "messages.json");
    const before = new CompanionMessageReceipts(filePath);
    before.add("request-a");
    before.add("request-a");
    const after = new CompanionMessageReceipts(filePath);
    expect(after.has("request-a")).toBe(true);
    expect(after.has("request-b")).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("does not accept a retry when saving the original receipt failed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fde-companion-receipts-"));
  try {
    const parent = path.join(directory, "not-a-directory");
    await writeFile(parent, "occupied");
    const receipts = new CompanionMessageReceipts(path.join(parent, "messages.json"));
    expect(() => receipts.add("request-a")).toThrow();
    expect(receipts.has("request-a")).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
