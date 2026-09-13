import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listProviderAgentDefinitions } from "./provider-agent-definitions.js";

describe("listProviderAgentDefinitions", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "fde-agent-defs-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function put(relative: string, content: string) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    return file;
  }

  it("lists user-level definitions per provider with frontmatter and toml fields", async () => {
    const claude = await put(
      "home/.claude/agents/reviewer.md",
      '---\nname: code-reviewer\ndescription: "Reviews diffs"\ntools: Read\n---\nBody',
    );
    const codex = await put(
      "home/.codex/agents/tester.toml",
      'name = "tester"\ndescription = "Runs tests"\n[extra]\nname = "ignored"\n',
    );
    const opencode = await put("xdg/opencode/agent/docs.md", "No frontmatter");
    await put("home/.claude/agents/notes.txt", "ignored");
    await put("project/.claude/agents/project-only.md", "---\nname: p\n---");

    const definitions = await listProviderAgentDefinitions({
      home: path.join(root, "home"),
      xdgConfigHome: path.join(root, "xdg"),
    });

    expect(definitions).toEqual([
      {
        provider: "claude",
        scope: "user",
        name: "code-reviewer",
        description: "Reviews diffs",
        path: claude,
      },
      {
        provider: "codex",
        scope: "user",
        name: "tester",
        description: "Runs tests",
        path: codex,
      },
      {
        provider: "opencode",
        scope: "user",
        name: "docs",
        description: null,
        path: opencode,
      },
    ]);
  });

  it("lists only project-level definitions when a project root is given", async () => {
    await put("home/.claude/agents/user.md", "---\nname: user\n---");
    const project = await put("project/.claude/agents/builder.md", "---\nname: builder\n---");
    const copilot = await put(
      "project/.github/agents/helper.agent.md",
      "---\ndescription: Helps\n---",
    );

    const definitions = await listProviderAgentDefinitions({
      home: path.join(root, "home"),
      xdgConfigHome: path.join(root, "xdg"),
      projectRoot: path.join(root, "project"),
    });

    expect(definitions).toEqual([
      {
        provider: "claude",
        scope: "project",
        name: "builder",
        description: null,
        path: project,
      },
      {
        provider: "copilot",
        scope: "project",
        name: "helper",
        description: "Helps",
        path: copilot,
      },
    ]);
  });
});
