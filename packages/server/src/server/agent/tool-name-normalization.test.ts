import { describe, expect, it } from "vitest";

import { getFdeToolLeafName, isFdeToolName } from "@fde/protocol/tool-name-normalization";

describe("isFdeToolName", () => {
  it("detects Claude Code format", () => {
    expect(isFdeToolName("mcp__fde__create_agent")).toBe(true);
    expect(isFdeToolName("mcp__fde__list_agents")).toBe(true);
  });

  it("detects fde_voice variant", () => {
    expect(isFdeToolName("mcp__fde_voice__create_agent")).toBe(true);
    expect(isFdeToolName("fde_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isFdeToolName("mcp__fde_voice__speak")).toBe(false);
    expect(isFdeToolName("mcp__fde__speak")).toBe(false);
    expect(isFdeToolName("fde.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isFdeToolName("fde.create_agent")).toBe(true);
  });

  it("rejects non-fde tools", () => {
    expect(isFdeToolName("Bash")).toBe(false);
    expect(isFdeToolName("Read")).toBe(false);
    expect(isFdeToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getFdeToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getFdeToolLeafName("mcp__fde__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getFdeToolLeafName("fde.create_agent")).toBe("create_agent");
    expect(getFdeToolLeafName("fde.list_agents")).toBe("list_agents");
  });

  it("returns null for non-fde tools", () => {
    expect(getFdeToolLeafName("Bash")).toBeNull();
  });
});
