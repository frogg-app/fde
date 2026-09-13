import { describe, expect, it } from "vitest";

import { getFroggToolLeafName, isFroggToolName } from "@frogg/protocol/tool-name-normalization";

describe("isFroggToolName", () => {
  it("detects Claude Code format", () => {
    expect(isFroggToolName("mcp__frogg__create_agent")).toBe(true);
    expect(isFroggToolName("mcp__frogg__list_agents")).toBe(true);
  });

  it("detects frogg_voice variant", () => {
    expect(isFroggToolName("mcp__frogg_voice__create_agent")).toBe(true);
    expect(isFroggToolName("frogg_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isFroggToolName("mcp__frogg_voice__speak")).toBe(false);
    expect(isFroggToolName("mcp__frogg__speak")).toBe(false);
    expect(isFroggToolName("frogg.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isFroggToolName("frogg.create_agent")).toBe(true);
  });

  it("rejects non-frogg tools", () => {
    expect(isFroggToolName("Bash")).toBe(false);
    expect(isFroggToolName("Read")).toBe(false);
    expect(isFroggToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getFroggToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getFroggToolLeafName("mcp__frogg__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getFroggToolLeafName("frogg.create_agent")).toBe("create_agent");
    expect(getFroggToolLeafName("frogg.list_agents")).toBe("list_agents");
  });

  it("returns null for non-frogg tools", () => {
    expect(getFroggToolLeafName("Bash")).toBeNull();
  });
});
