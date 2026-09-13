import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCliParseArgv } from "./run";

describe("runCli", () => {
  it("shows help for a bare invocation instead of starting onboarding", () => {
    expect(
      createCliParseArgv({
        argv: [],
        cwd: process.cwd(),
        nodeArgv: ["node", "frogg"],
      }),
    ).toEqual(["node", "frogg", "--help"]);
  });

  it("routes explicit root relay flags to onboard", () => {
    expect(
      createCliParseArgv({
        argv: ["--relay"],
        cwd: process.cwd(),
        nodeArgv: ["node", "frogg"],
      }),
    ).toEqual(["node", "frogg", "onboard", "--relay"]);
    expect(
      createCliParseArgv({
        argv: ["--no-relay"],
        cwd: process.cwd(),
        nodeArgv: ["node", "frogg"],
      }),
    ).toEqual(["node", "frogg", "onboard", "--no-relay"]);
  });

  it("preserves known CLI command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["daemon", "set-password"],
        cwd: process.cwd(),
        nodeArgv: ["node", "frogg"],
      }),
    ).toEqual(["node", "frogg", "daemon", "set-password"]);
  });

  it("recognizes legacy daemon commands even beside a directory named daemon", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frogg-cli-legacy-"));
    mkdirSync(path.join(root, "daemon"));
    try {
      expect(
        createCliParseArgv({
          argv: ["daemon", "start", "--foreground"],
          cwd: root,
          nodeArgv: ["node", "frogg"],
        }),
      ).toEqual(["node", "frogg", "daemon", "start", "--foreground"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves the hooks command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["hooks", "claude", "UserPromptSubmit"],
        cwd: process.cwd(),
        nodeArgv: ["node", "frogg"],
      }),
    ).toEqual(["node", "frogg", "hooks", "claude", "UserPromptSubmit"]);
  });

  it("classifies existing unknown directories as open-project invocations", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frogg-cli-run-"));
    const project = path.join(root, "repository");
    mkdirSync(project);

    try {
      expect(
        createCliParseArgv({
          argv: ["repository"],
          cwd: root,
          nodeArgv: ["node", "frogg"],
        }),
      ).toEqual({
        kind: "open-project",
        resolvedPath: project,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
