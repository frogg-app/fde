import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { brand } from "@frogg/branding";
import { installedSkillName } from "@frogg/branding/skills";
import { syncSkills, removeSkill } from "./sync.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("does not update or remove another product's provider files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brand-skills-"));
  roots.push(root);
  const sourceDir = path.join(root, "source");
  await mkdir(path.join(sourceDir, "frogg"), { recursive: true });
  await writeFile(path.join(sourceDir, "frogg/SKILL.md"), "bundled instructions");
  const targets = {
    agentsDir: path.join(root, "agents"),
    claudeDir: path.join(root, "claude"),
    codexDir: path.join(root, "codex"),
  };
  await syncSkills({ sourceDir, ...targets, skillNames: ["frogg"] });
  const installed = path.join(targets.agentsDir, installedSkillName(brand, "frogg"));
  await writeFile(
    path.join(installed, ".frogg-managed-files.json"),
    JSON.stringify({
      version: 1,
      brand: { id: "other", applicationId: "com.other.studio" },
      files: {},
    }),
  );
  await writeFile(path.join(installed, "SKILL.md"), "other product instructions");
  await expect(syncSkills({ sourceDir, ...targets, skillNames: ["frogg"] })).rejects.toThrow(
    "another product",
  );
  await expect(removeSkill("frogg", targets)).rejects.toThrow("another product");
  expect(await readFile(path.join(installed, "SKILL.md"), "utf8")).toBe(
    "other product instructions",
  );
});
it("keeps custom physical names distinct while preserving logical names", () => {
  expect(installedSkillName({ id: "acme", legacyFrogg: false }, "frogg")).toBe("acme-frogg");
  expect(installedSkillName({ id: "beta", legacyFrogg: false }, "frogg")).toBe("beta-frogg");
  expect(installedSkillName({ id: "frogg", legacyFrogg: true }, "frogg")).toBe("frogg");
  expect(() => installedSkillName(brand, "../frogg")).toThrow("Invalid skill name");
});

it("rolls back only the active product's physical skill directory", async () => {
  const { beginSkillsTransaction } = await import("./transaction.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "brand-skills-rollback-"));
  roots.push(root);
  const sourceDir = path.join(root, "source");
  await mkdir(path.join(sourceDir, "frogg"), { recursive: true });
  await writeFile(path.join(sourceDir, "frogg/SKILL.md"), "instructions");
  const targets = {
    sourceDir,
    agentsDir: path.join(root, "agents"),
    claudeDir: path.join(root, "claude"),
    codexDir: path.join(root, "codex"),
  };
  await syncSkills({ ...targets, skillNames: ["frogg"] });
  const untouched = path.join(targets.agentsDir, "other-frogg");
  await mkdir(untouched);
  await writeFile(path.join(untouched, "SKILL.md"), "other instructions");
  const transaction = await beginSkillsTransaction(
    targets,
    { mode: "all" },
    { mode: "custom", skills: [] },
    [{ kind: "delete", name: "frogg" }],
  );
  const installed = path.join(targets.agentsDir, installedSkillName(brand, "frogg"), "SKILL.md");
  await expect(readFile(installed, "utf8")).rejects.toThrow();
  await transaction.rollback();
  expect(await readFile(installed, "utf8")).toBe("instructions");
  expect(await readFile(path.join(untouched, "SKILL.md"), "utf8")).toBe("other instructions");
});
