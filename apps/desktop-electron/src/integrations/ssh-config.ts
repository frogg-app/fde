import { glob, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SshConfigHost {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}
export interface SshConfigFiles {
  read(file: string): Promise<string | null>;
  matches(pattern: string): Promise<string[]>;
}

function words(value: string): string[] {
  return (value.match(/"[^"]*"|'[^']*'|[^\s#]+/g) ?? []).map((word) =>
    word.replace(/^(["'])(.*)\1$/, "$2"),
  );
}

interface Directive {
  keyword: string;
  values: string[];
}
function directive(raw: string): Directive | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;
  const match = /^([^\s=]+)[\s=]+(.*)$/.exec(line);
  if (!match) return null;
  return { keyword: match[1]!.toLowerCase(), values: words(match[2]!) };
}
function applyProperty(host: SshConfigHost, keyword: string, value: string): void {
  if (keyword === "hostname") host.hostName ??= value;
  if (keyword === "user") host.user ??= value;
  if (keyword === "identityfile") host.identityFile ??= value;
  if (keyword !== "port" || !/^\d+$/.test(value)) return;
  const port = Number(value);
  if (port > 0 && port <= 65535) host.port ??= port;
}
function mergeMetadata(targets: SshConfigHost[], entries: SshConfigHost[]): void {
  for (const entry of entries) {
    for (const host of targets) {
      host.hostName ??= entry.hostName;
      host.user ??= entry.user;
      host.port ??= entry.port;
      host.identityFile ??= entry.identityFile;
    }
  }
}
function expandInclude(home: string, pattern: string): string {
  if (pattern.startsWith("~/")) return path.join(home, pattern.slice(2));
  if (path.isAbsolute(pattern)) return pattern;
  return path.join(home, ".ssh", pattern);
}
/** Picker metadata only: OpenSSH evaluates aliases, Match, credentials and defaults. */
export async function readSshConfigHosts(
  home: string,
  files: SshConfigFiles,
): Promise<SshConfigHost[]> {
  async function includedHosts(patterns: string[]): Promise<SshConfigHost[]> {
    const entries: SshConfigHost[] = [];
    for (const pattern of patterns) {
      const matches = await files.matches(expandInclude(home, pattern));
      for (const included of matches.sort()) entries.push(...(await parse(included, false)));
    }
    return entries;
  }
  async function parse(file: string, includes: boolean): Promise<SshConfigHost[]> {
    const text = await files.read(file);
    if (text === null) return [];
    const hosts: SshConfigHost[] = [];
    let current: SshConfigHost[] | null = null;
    for (const raw of text.split(/\r?\n/)) {
      const parsed = directive(raw);
      if (!parsed) continue;
      const { keyword, values } = parsed;
      if (keyword === "host" || keyword === "match") {
        if (current) hosts.push(...current);
        current =
          keyword === "host"
            ? values.filter((alias) => !/[*?!]/.test(alias)).map((alias) => ({ alias }))
            : null;
        continue;
      }
      if (keyword === "include" && includes) {
        const entries = await includedHosts(values);
        if (current) mergeMetadata(current, entries);
        else hosts.push(...entries);
        continue;
      }
      const value = values[0];
      if (!current || !value) continue;
      for (const host of current) applyProperty(host, keyword, value);
    }
    if (current) hosts.push(...current);
    return hosts;
  }
  const unique = new Map<string, SshConfigHost>();
  for (const host of await parse(path.join(home, ".ssh", "config"), true)) {
    if (!unique.has(host.alias)) unique.set(host.alias, host);
  }
  return [...unique.values()];
}

export async function listSshConfigHosts(): Promise<SshConfigHost[]> {
  return readSshConfigHosts(os.homedir(), {
    async read(file) {
      try {
        return await readFile(file, "utf8");
      } catch {
        return null;
      }
    },
    async matches(pattern) {
      const matches: string[] = [];
      try {
        for await (const file of glob(pattern)) matches.push(file);
      } catch {
        /* Unreadable includes add no picker entries. */
      }
      return matches;
    },
  });
}
