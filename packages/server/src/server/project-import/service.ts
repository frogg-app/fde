import {
  assertDestinationIdentity,
  materializeProject,
  readDaemonConversations,
} from "./filesystem.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { ImportUpload, resolveImportDirectory, disposeMaterialization } from "./upload.js";
import { parseImportedTranscript, type ImportedTranscript } from "./transcript.js";

export interface ImportCandidate {
  id: string;
  provider: string;
  title: string;
  sourcePath: string;
  mode: "resumable" | "transcript";
  alreadyImportedAgentId: string | null;
  messageCount: number | null;
}
interface NativeCandidate {
  provider: string;
  providerHandleId: string;
  cwd: string;
  title: string | null;
  alreadyImportedAgentId?: string | null;
}
interface ImportPorts {
  listNative(cwd: string): Promise<NativeCandidate[]>;
  importNative(session: NativeCandidate): Promise<{ agentId: string; skipped: boolean }>;
  ensureProject(cwd: string): Promise<{ projectId: string }>;
  findProject?(cwd: string): Promise<{ projectId: string } | null>;
}
interface Transaction {
  upload: ImportUpload;
  source: "daemon" | "client";
  cwd: string;
  expires: number;
  committing?: boolean;
  materialized?: boolean;
  conversationDirectory?: string;
  sessions: Map<
    string,
    { candidate: ImportCandidate; native?: NativeCandidate; transcript?: ImportedTranscript }
  >;
  committed?: {
    projectId: string;
    importedAgentIds: string[];
    importedTranscriptIds: string[];
    skippedTranscriptIds: string[];
    skippedAgentIds: string[];
    failures: Array<{ sessionId: string; error: string }>;
  };
}
const queues = new Map<string, Promise<unknown>>();
const transactionsByHome = new Map<string, Map<string, Transaction>>();
const cleanupStarted = new Set<string>();
async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const work = (queues.get(key) ?? Promise.resolve()).then(fn);
  const tail = work.catch(() => undefined);
  queues.set(key, tail);
  try {
    return await work;
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}
function expand(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return path.join(homedir(), cwd.slice(2));
  return path.resolve(cwd);
}

export class ProjectImportService {
  private readonly transactions: Map<string, Transaction>;
  constructor(
    private readonly home: string,
    private readonly ports: ImportPorts,
  ) {
    this.transactions = transactionsByHome.get(home) ?? new Map();
    transactionsByHome.set(home, this.transactions);
    if (!cleanupStarted.has(home)) {
      cleanupStarted.add(home);
      const transactions = this.transactions;
      const timer = setInterval(
        () => {
          void expireUploads(home, transactions).catch(() => undefined);
        },
        5 * 60 * 1000,
      );
      timer.unref();
    }
  }

  async prepare(
    source: "daemon" | "client",
    requestedCwd: string,
    conversationDirectory?: string,
  ): Promise<{ importId: string; cwd: string; projectId: string | null }> {
    await this.expire();
    if ([...this.transactions.values()].filter((tx) => !tx.committed).length >= 3)
      throw new Error("Finish or cancel an existing import first");
    const resolved = expand(requestedCwd);
    let cwd: string;
    if (source === "daemon") cwd = await resolveImportDirectory(resolved);
    else {
      // Canonicalize existing paths or the parent of a new destination. Never infer client paths.
      cwd = await resolveImportDirectory(resolved).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return path.join(
          await resolveImportDirectory(path.dirname(resolved)),
          path.basename(resolved),
        );
      });
    }
    const root = path.join(this.home, "project-import-staging", randomUUID());
    await mkdir(root, { recursive: true, mode: 0o700 });
    const upload = new ImportUpload(root);
    this.transactions.set(upload.id, {
      upload,
      source,
      cwd,
      expires: Date.now() + 60 * 60 * 1000,
      sessions: new Map(),
      conversationDirectory: conversationDirectory?.trim()
        ? await resolveImportDirectory(expand(conversationDirectory))
        : undefined,
    });
    return {
      importId: upload.id,
      cwd,
      projectId: (await this.ports.findProject?.(cwd))?.projectId ?? null,
    };
  }

  async upload(importId: string, input: Parameters<ImportUpload["write"]>[0]): Promise<void> {
    return this.withTransaction(importId, async (transaction) => {
      if (transaction.source !== "client" || transaction.committed || transaction.committing)
        throw new Error("This import does not accept uploads");
      transaction.sessions.clear();
      await transaction.upload.write(input);
    });
  }

  async preview(
    importId: string,
  ): Promise<{ cwd: string; sessions: ImportCandidate[]; fileCount: number; totalBytes: number }> {
    return this.withTransaction(importId, async (tx) => {
      if (tx.committing) throw new Error("Import is being committed");
      tx.sessions.clear();
      if (tx.source === "daemon") {
        const cwd = await resolveImportDirectory(tx.cwd);
        for (const native of await this.ports.listNative(cwd)) {
          if ((await resolveImportDirectory(native.cwd).catch(() => null)) !== cwd) continue;
          const id = createHash("sha256")
            .update(JSON.stringify([native.provider, native.providerHandleId]))
            .digest("hex");
          tx.sessions.set(id, {
            native,
            candidate: {
              id,
              provider: native.provider,
              title: native.title ?? native.providerHandleId,
              sourcePath: native.cwd,
              mode: "resumable",
              alreadyImportedAgentId: native.alreadyImportedAgentId ?? null,
              messageCount: null,
            },
          });
        }
      }
      let transcriptFiles: Array<{ path: string; content: Buffer }> = [];
      if (tx.source === "client") transcriptFiles = await tx.upload.conversations();
      else if (tx.conversationDirectory)
        transcriptFiles = await readDaemonConversations(tx.conversationDirectory);
      {
        for (const file of transcriptFiles) {
          const transcript = parseImportedTranscript(file.content);
          tx.sessions.set(transcript.id, {
            transcript,
            candidate: {
              id: transcript.id,
              provider: transcript.provider,
              title: transcript.title,
              sourcePath: file.path,
              mode: "transcript",
              alreadyImportedAgentId: null,
              messageCount: transcript.messages.length,
            },
          });
        }
      }
      if (tx.sessions.size > 500) throw new Error("Select at most 500 conversations per import");
      return {
        cwd: tx.cwd,
        sessions: [...tx.sessions.values()].map((entry) => entry.candidate),
        fileCount: tx.upload.files.size,
        totalBytes: tx.upload.totalBytes,
      };
    });
  }

  async commit(importId: string, ids: string[]): Promise<NonNullable<Transaction["committed"]>> {
    return this.withTransaction(importId, async (tx) =>
      serial(`${this.home}:${tx.cwd}`, async () => {
        if (tx.committed) return tx.committed;
        const selected = [...new Set(ids)].map((id) => {
          const value = tx.sessions.get(id);
          if (!value) throw new Error("Preview the selected conversations again before importing");
          return value;
        });
        if (!selected.length) throw new Error("Select at least one conversation");
        tx.committing = true;
        try {
          if (tx.source === "client" && !tx.materialized) {
            await this.installProjectFiles(tx);
            tx.materialized = true;
          }
          await assertDestinationIdentity(tx.cwd, true);
          const project = await this.ports.ensureProject(tx.cwd);
          const importedAgentIds: string[] = [],
            skippedAgentIds: string[] = [];
          const importedTranscriptIds: string[] = [],
            skippedTranscriptIds: string[] = [];
          const failures: Array<{ sessionId: string; error: string }> = [];
          for (const entry of selected) {
            try {
              if (entry.native) {
                const native = await this.ports.importNative(entry.native);
                (native.skipped ? skippedAgentIds : importedAgentIds).push(native.agentId);
              } else if (entry.transcript) {
                const inserted = await this.saveTranscript(project.projectId, entry.transcript);
                (inserted ? importedTranscriptIds : skippedTranscriptIds).push(entry.transcript.id);
              }
            } catch (error) {
              failures.push({
                sessionId: entry.candidate.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          const result = {
            projectId: project.projectId,
            importedAgentIds,
            skippedAgentIds,
            importedTranscriptIds,
            skippedTranscriptIds,
            failures,
          };
          if (!failures.length) {
            tx.committed = result;
            tx.sessions.clear();
            await tx.upload.dispose().catch(() => undefined);
            tx.upload.files.clear();
          }
          return result;
        } finally {
          tx.committing = false;
        }
      }),
    );
  }

  private async installProjectFiles(tx: Transaction): Promise<void> {
    await materializeProject(tx.cwd, tx.upload);
  }

  private async withTransaction<T>(
    id: string,
    operation: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return serial(`transaction:${this.home}:${id}`, () => operation(this.get(id)));
  }

  private async saveTranscript(
    projectId: string,
    transcript: ImportedTranscript,
  ): Promise<boolean> {
    return serial(`history:${this.home}:${projectId}:${transcript.id}`, () =>
      this.saveTranscriptNow(projectId, transcript),
    );
  }

  private async saveTranscriptNow(
    projectId: string,
    transcript: ImportedTranscript,
  ): Promise<boolean> {
    const directory = this.historyDirectory(projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, `${transcript.id}.json`);
    const saved = await readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (saved) {
      const previous = JSON.parse(saved) as ImportedTranscript;
      const isPrefix = (
        shorter: ImportedTranscript["messages"],
        longer: ImportedTranscript["messages"],
      ) =>
        shorter.length <= longer.length &&
        shorter.every(
          (message, index) =>
            message.role === longer[index].role && message.text === longer[index].text,
        );
      if (isPrefix(transcript.messages, previous.messages)) return false;
      if (!isPrefix(previous.messages, transcript.messages))
        throw new Error(
          "This conversation differs from its existing imported history; neither version was overwritten",
        );
    }
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(transcript), { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
    return true;
  }

  async listHistory(
    projectId: string,
  ): Promise<Array<Pick<ImportedTranscript, "id" | "provider" | "title">>> {
    const directory = this.historyDirectory(projectId);
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const results = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const item = await this.readHistory(projectId, name.slice(0, -5));
      results.push({ id: item.id, provider: item.provider, title: item.title });
    }
    return results;
  }

  async readHistory(projectId: string, id: string): Promise<ImportedTranscript> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid imported conversation ID");
    return JSON.parse(
      await readFile(path.join(this.historyDirectory(projectId), `${id}.json`), "utf8"),
    ) as ImportedTranscript;
  }

  async cancel(importId: string): Promise<void> {
    return this.withTransaction(importId, async (tx) => {
      if (tx.committing) throw new Error("Wait for the current import to finish");
      await tx.upload.dispose();
      this.transactions.delete(importId);
    });
  }

  private historyDirectory(projectId: string): string {
    const key = createHash("sha256").update(projectId).digest("hex");
    return path.join(this.home, "project-conversations", key);
  }
  private get(id: string): Transaction {
    const tx = this.transactions.get(id);
    if (!tx || tx.expires < Date.now()) throw new Error("Import expired; select the source again");
    tx.expires = Date.now() + 60 * 60 * 1000;
    return tx;
  }
  private async expire(): Promise<void> {
    await expireUploads(this.home, this.transactions);
  }
}

async function expireUploads(home: string, transactions: Map<string, Transaction>): Promise<void> {
  for (const [id, tx] of transactions) {
    if (tx.expires >= Date.now() || tx.committing) continue;
    await serial(`transaction:${home}:${id}`, async () => {
      if (tx.expires >= Date.now() || tx.committing) return;
      await tx.upload.dispose();
      transactions.delete(id);
    });
  }
  const root = path.join(home, "project-import-staging");
  const names = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const active = new Set([...transactions.values()].map((tx) => tx.upload.root));
  for (const entry of names) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if (active.has(directory)) continue;
    try {
      if ((await stat(directory)).mtimeMs >= Date.now() - 60 * 60 * 1000) continue;
      await disposeMaterialization(directory);
      await rm(directory, { recursive: true, force: true });
    } catch {
      /* Retain an inaccessible orphan; other imports remain usable. */
    }
  }
}
