import { mkdtemp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyAttachmentFileToManagedStorage, readManagedFileBase64 } from "./attachments";

const originalFroggHome = process.env.FROGG_HOME;
let testHome: string | null = null;

async function useTempFroggHome(): Promise<string> {
  testHome = await mkdtemp(path.join(os.tmpdir(), "frogg-desktop-attachments-"));
  process.env.FROGG_HOME = testHome;
  return testHome;
}

describe("desktop attachment files", () => {
  afterEach(async () => {
    if (originalFroggHome === undefined) {
      delete process.env.FROGG_HOME;
    } else {
      process.env.FROGG_HOME = originalFroggHome;
    }

    if (testHome) {
      await rm(testHome, { recursive: true, force: true });
      testHome = null;
    }
  });

  it("rejects sparse oversized sources without overwriting managed attachments", async () => {
    const home = await useTempFroggHome();
    const sourcePath = path.join(home, "large.zip");
    const source = await open(sourcePath, "w");
    await source.truncate(1024 ** 3);
    await source.close();
    const managed = path.join(home, "desktop-attachments");
    await mkdir(managed);
    const target = path.join(managed, "existing.bin");
    await writeFile(target, "keep me");
    await expect(
      copyAttachmentFileToManagedStorage({
        attachmentId: "existing",
        sourcePath,
      }),
    ).rejects.toThrow("ATTACHMENT_TOO_LARGE:");
    expect(await readFile(target, "utf8")).toBe("keep me");
  });

  it("rejects an oversized managed file before base64 conversion", async () => {
    const home = await useTempFroggHome();
    const managed = path.join(home, "desktop-attachments");
    await mkdir(managed);
    const filePath = path.join(managed, "large.bin");
    const file = await open(filePath, "w");
    await file.truncate(1024 ** 3);
    await file.close();
    await expect(readManagedFileBase64({ path: filePath })).rejects.toThrow(
      "ATTACHMENT_TOO_LARGE:",
    );
  });

  it("accepts dot-prefixed picker extensions for managed copies", async () => {
    const froggHome = await useTempFroggHome();
    const sourcePath = path.join(froggHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown",
      sourcePath,
      extension: ".md",
    });

    expect(result).toEqual({
      path: path.join(froggHome, "desktop-attachments", "att_markdown.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  it("normalizes legacy bare extensions for managed copies", async () => {
    const froggHome = await useTempFroggHome();
    const sourcePath = path.join(froggHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown_legacy",
      sourcePath,
      extension: "md",
    });

    expect(result).toEqual({
      path: path.join(froggHome, "desktop-attachments", "att_markdown_legacy.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });
});
