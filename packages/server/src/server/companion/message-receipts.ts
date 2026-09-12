import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Persist acceptance before acknowledgement so reconnect retries cannot repeat a dispatch. */
export class CompanionMessageReceipts {
  private readonly ids = new Set<string>();
  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    const ids = z.array(z.string()).parse(JSON.parse(readFileSync(filePath, "utf8")));
    for (const id of ids.slice(-10000)) this.ids.add(id);
  }
  has(id: string): boolean {
    return this.ids.has(id);
  }
  add(id: string): void {
    const next = new Set(this.ids);
    next.add(id);
    if (next.size > 10000) {
      const oldest = next.values().next().value;
      if (oldest !== undefined) next.delete(oldest);
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(Array.from(next)), { mode: 0o600 });
    renameSync(temporary, this.filePath);
    this.ids.clear();
    for (const value of next) this.ids.add(value);
  }
}
