import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentProviderDefinition } from "@frogg/protocol/messages";

/**
 * Read-only discovery of agent definitions that providers already load from
 * disk. Frogg does not own these files; it only lists what each provider CLI
 * would pick up so users can see and open them.
 */

type DefinitionFormat = "markdown" | "toml";

interface ProviderAgentDirSpec {
  provider: string;
  format: DefinitionFormat;
  /** File-name suffix a definition must carry, e.g. ".md" or ".agent.md". */
  suffix: string;
  userDirs: (env: DefinitionEnv) => string[];
  projectDirs: (root: string) => string[];
}

interface DefinitionEnv {
  home: string;
  xdgConfigHome: string;
}

export const PROVIDER_AGENT_DIR_SPECS: readonly ProviderAgentDirSpec[] = [
  {
    // Claude Code subagents: YAML frontmatter with name/description.
    provider: "claude",
    format: "markdown",
    suffix: ".md",
    userDirs: ({ home }) => [path.join(home, ".claude", "agents")],
    projectDirs: (root) => [path.join(root, ".claude", "agents")],
  },
  {
    // Codex custom agents: TOML files with name/description.
    provider: "codex",
    format: "toml",
    suffix: ".toml",
    userDirs: ({ home }) => [path.join(home, ".codex", "agents")],
    projectDirs: (root) => [path.join(root, ".codex", "agents")],
  },
  {
    // OpenCode agents: markdown named after the file; both dir spellings are accepted.
    provider: "opencode",
    format: "markdown",
    suffix: ".md",
    userDirs: ({ xdgConfigHome }) => [
      path.join(xdgConfigHome, "opencode", "agent"),
      path.join(xdgConfigHome, "opencode", "agents"),
    ],
    projectDirs: (root) => [
      path.join(root, ".opencode", "agent"),
      path.join(root, ".opencode", "agents"),
    ],
  },
  {
    // GitHub Copilot custom agents.
    provider: "copilot",
    format: "markdown",
    suffix: ".agent.md",
    userDirs: ({ home }) => [path.join(home, ".copilot", "agents")],
    projectDirs: (root) => [path.join(root, ".github", "agents")],
  },
];

export interface ListProviderAgentDefinitionsOptions {
  projectRoot?: string | null;
  home?: string;
  xdgConfigHome?: string;
  specs?: readonly ProviderAgentDirSpec[];
}

export async function listProviderAgentDefinitions(
  options: ListProviderAgentDefinitionsOptions = {},
): Promise<AgentProviderDefinition[]> {
  const home = options.home ?? os.homedir();
  const env: DefinitionEnv = {
    home,
    xdgConfigHome:
      options.xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
  };
  const specs = options.specs ?? PROVIDER_AGENT_DIR_SPECS;
  const jobs: Promise<AgentProviderDefinition[]>[] = [];
  for (const spec of specs) {
    const scopes: Array<["user" | "project", string[]]> = [];
    if (options.projectRoot) {
      scopes.push(["project", spec.projectDirs(options.projectRoot)]);
    } else {
      scopes.push(["user", spec.userDirs(env)]);
    }
    for (const [scope, dirs] of scopes) {
      for (const dir of dirs) {
        jobs.push(readDefinitionDir(spec, scope, dir));
      }
    }
  }
  const results = (await Promise.all(jobs)).flat();
  return results.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
  );
}

async function readDefinitionDir(
  spec: ProviderAgentDirSpec,
  scope: "user" | "project",
  dir: string,
): Promise<AgentProviderDefinition[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((entry) => entry.endsWith(spec.suffix)).sort();
  const definitions = await Promise.all(
    files.map(async (file): Promise<AgentProviderDefinition | null> => {
      const filePath = path.join(dir, file);
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        return null;
      }
      const fallbackName = file.slice(0, -spec.suffix.length);
      const fields =
        spec.format === "toml" ? parseTomlTopLevel(content) : parseMarkdownFrontmatter(content);
      return {
        provider: spec.provider,
        scope,
        name: fields.name || fallbackName,
        description: fields.description || null,
        path: filePath,
      };
    }),
  );
  return definitions.filter((entry): entry is AgentProviderDefinition => entry !== null);
}

interface DefinitionFields {
  name?: string;
  description?: string;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

/** Only top-level scalar `name`/`description` keys matter; no YAML dependency needed. */
export function parseMarkdownFrontmatter(content: string): DefinitionFields {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  return readKeyValues(match[1], ":");
}

export function parseTomlTopLevel(content: string): DefinitionFields {
  const header = content.split(/^\s*\[/m)[0] ?? "";
  return readKeyValues(header, "=");
}

function readKeyValues(block: string, separator: string): DefinitionFields {
  const fields: DefinitionFields = {};
  for (const line of block.split(/\r?\n/)) {
    const index = line.indexOf(separator);
    if (index <= 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, index).trim();
    const value = unquote(line.slice(index + 1));
    if (!value || value === "|" || value === ">") continue;
    if (key === "name") fields.name = value;
    if (key === "description") fields.description = value;
  }
  return fields;
}
