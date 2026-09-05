import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "../atomic-file.js";
import {
  EMPTY_NOTEBOOK,
  applyNote,
  parseNotebook,
  serializeNotebookForPrompt,
  type CompanionNoteInput,
  type CompanionNotebook,
} from "./notebook.js";

export interface CompanionNotebookStoreOptions {
  filePath: string;
  now?: () => Date;
  write?: typeof writeJsonFileAtomic;
}

export function companionNotebookPath(fdeHome: string): string {
  return path.join(fdeHome, "companion", "notebook.json");
}

/**
 * Owns the notebook file end to end. Callers never read, merge, or write it
 * themselves: every mutation goes through a method here, and concurrent
 * mutations are serialised on one tail promise so a lost update is impossible.
 */
export class CompanionNotebookStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly write: typeof writeJsonFileAtomic;
  private notebook: CompanionNotebook | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: CompanionNotebookStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? (() => new Date());
    this.write = options.write ?? writeJsonFileAtomic;
  }

  async get(): Promise<CompanionNotebook> {
    return this.enqueue(() => this.loaded());
  }

  async note(input: CompanionNoteInput): Promise<CompanionNotebook> {
    return this.enqueue(async () => {
      const current = await this.loaded();
      const next = applyNote(current, input, this.now().toISOString());
      await this.write(this.filePath, next);
      this.notebook = next;
      return next;
    });
  }

  async promptText(): Promise<string> {
    return serializeNotebookForPrompt(await this.get());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async loaded(): Promise<CompanionNotebook> {
    if (this.notebook) {
      return this.notebook;
    }
    this.notebook = parseNotebook(await this.readFromDisk());
    return this.notebook;
  }

  private async readFromDisk(): Promise<unknown> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return EMPTY_NOTEBOOK;
      }
      throw error;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return EMPTY_NOTEBOOK;
    }
  }
}
