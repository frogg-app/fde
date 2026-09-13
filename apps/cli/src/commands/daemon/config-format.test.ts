import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { expect, test } from "vitest";
import { runConfigFormatCommand } from "./config-format.js";

test("formats the selected daemon home and reports its path", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fde-config-format-"));
  const configPath = path.join(home, "config.json");
  const original = { daemon: { listen: "127.0.0.1:8123" } };
  try {
    writeFileSync(configPath, JSON.stringify(original));
    const result = await runConfigFormatCommand({ home }, new Command());
    expect(result.data).toEqual({ configPath });
    expect(readFileSync(configPath, "utf8")).toBe(JSON.stringify(original, null, 2) + "\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
