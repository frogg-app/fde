import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

export const IMPORT_LIMITS = {
  files: 2000,
  totalBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  chunkBytes: 192 * 1024,
};
const FORBIDDEN =
  /^(?:\.git|\.fde-import-owner|node_modules|\.env(?:\..*)?|credentials(?:\.json)?|auth\.json)$/i;

export function validateImportPath(value: string): string {
  const pieces = value.split("/");
  if (
    !value ||
    value.length > 1024 ||
    value.includes("\\") ||
    pieces.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        [...part].some((character) => character.charCodeAt(0) < 32) ||
        /[<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
        FORBIDDEN.test(part),
    )
  ) {
    throw new Error("Invalid or excluded import path");
  }
  return pieces.join("/");
}

/** Private staging directory with sequential bounded writes, no archive extraction or symlinks. */
export class ImportUpload {
  readonly id = randomUUID();
  readonly files = new Map<
    string,
    { bytes: number; complete: boolean; kind: "code" | "conversation" }
  >();
  private readonly foldedPaths = new Set<string>();
  totalBytes = 0;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}

  async write(input: {
    path: string;
    kind: "code" | "conversation";
    offset: number;
    contentBase64: string;
    complete: boolean;
  }): Promise<void> {
    const operation = this.pending.then(() => this.writeNow(input));
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  private async writeNow(input: {
    path: string;
    kind: "code" | "conversation";
    offset: number;
    contentBase64: string;
    complete: boolean;
  }): Promise<void> {
    const relative = validateImportPath(input.path);
    if (
      input.contentBase64.length > Math.ceil(IMPORT_LIMITS.chunkBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)
    ) {
      throw new Error("Invalid upload chunk");
    }
    const data = Buffer.from(input.contentBase64, "base64");
    const current = this.files.get(relative);
    if (
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      current?.complete ||
      input.offset !== (current?.bytes ?? 0) ||
      (current && current.kind !== input.kind)
    ) {
      throw new Error("Upload offset or file state does not match; preview before retrying");
    }
    if (
      (!current && this.files.size >= IMPORT_LIMITS.files) ||
      data.length > IMPORT_LIMITS.chunkBytes ||
      input.offset + data.length > IMPORT_LIMITS.fileBytes ||
      this.totalBytes + data.length > IMPORT_LIMITS.totalBytes
    ) {
      throw new Error("Project import exceeds file or byte limits");
    }
    if (!current && this.foldedPaths.has(relative.toLowerCase()))
      throw new Error("Import paths collide on case-insensitive filesystems");
    const filename = path.join(this.root, input.kind, relative);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const file = await open(
      filename,
      constants.O_WRONLY |
        constants.O_NOFOLLOW |
        (current ? constants.O_APPEND : constants.O_CREAT | constants.O_EXCL),
      0o600,
    );
    try {
      await file.writeFile(data);
    } finally {
      await file.close();
    }
    this.files.set(relative, {
      bytes: input.offset + data.length,
      complete: input.complete,
      kind: input.kind,
    });
    this.foldedPaths.add(relative.toLowerCase());
    this.totalBytes += data.length;
  }

  async conversations(): Promise<Array<{ path: string; content: Buffer }>> {
    await this.pending;
    if ([...this.files.values()].some((file) => !file.complete))
      throw new Error("Some project files have not finished uploading");
    const results = [];
    for (const [relative, file] of this.files) {
      if (file.kind === "conversation")
        results.push({
          path: relative,
          content: await readFile(path.join(this.root, "conversation", relative)),
        });
    }
    return results;
  }

  async dispose(): Promise<void> {
    await this.pending;
    await disposeMaterialization(this.root);
    await rm(this.root, { recursive: true, force: true });
  }
}

export async function resolveImportDirectory(directory: string): Promise<string> {
  const resolved = await realpath(directory);
  if (!(await stat(resolved)).isDirectory())
    throw new Error("Select an existing project directory on the daemon");
  return resolved;
}

export async function disposeMaterialization(root: string): Promise<void> {
  const manifest = await readFile(path.join(root, "materialization.json"), "utf8").catch(
    () => null,
  );
  if (!manifest) return;
  let entry: { path?: unknown; owner?: unknown };
  try {
    entry = JSON.parse(manifest);
  } catch {
    return;
  }
  if (!entry || typeof entry !== "object") return;
  if (
    typeof entry.path !== "string" ||
    typeof entry.owner !== "string" ||
    !path.basename(entry.path).startsWith(".fde-project-import-")
  )
    return;
  if ((await realpath(entry.path).catch(() => null)) !== entry.path) return;
  const owner = await readFile(path.join(entry.path, ".fde-import-owner"), "utf8").catch(
    () => null,
  );
  if (owner === entry.owner) await rm(entry.path, { recursive: true, force: true });
}
