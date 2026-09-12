import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { brand } from "@fde/branding";
import { installedSkillName } from "@fde/branding/skills";
import { syncSkills, removeSkill } from "./sync.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("does not update or remove another product's provider files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brand-skills-"));
  roots.push(root);
  const sourceDir = path.join(root, "source");
  await mkdir(path.join(sourceDir, "fde"), { recursive: true });
  await writeFile(path.join(sourceDir, "fde/SKILL.md"), "bundled instructions");
  const targets = {
    agentsDir: path.join(root, "agents"),
    claudeDir: path.join(root, "claude"),
    codexDir: path.join(root, "codex"),
  };
  await syncSkills({ sourceDir, ...targets, skillNames: ["fde"] });
  const installed = path.join(targets.agentsDir, installedSkillName(brand, "fde"));
  await writeFile(
    path.join(installed, ".fde-managed-files.json"),
    JSON.stringify({
      version: 1,
      brand: { id: "other", applicationId: "com.other.studio" },
      files: {},
    }),
  );
  await writeFile(path.join(installed, "SKILL.md"), "other product instructions");
  await expect(syncSkills({ sourceDir, ...targets, skillNames: ["fde"] })).rejects.toThrow(
    "another product",
  );
  await expect(removeSkill("fde", targets)).rejects.toThrow("another product");
  expect(await readFile(path.join(installed, "SKILL.md"), "utf8")).toBe(
    "other product instructions",
  );
});
it("keeps custom physical names distinct while preserving logical names", () => {
  expect(installedSkillName({ id: "acme", legacyFde: false }, "fde")).toBe("acme-fde");
  expect(installedSkillName({ id: "beta", legacyFde: false }, "fde")).toBe("beta-fde");
  expect(installedSkillName({ id: "fde", legacyFde: true }, "fde")).toBe("fde");
  expect(() => installedSkillName(brand, "../fde")).toThrow("Invalid skill name");
});

it("rolls back only the active product's physical skill directory", async () => {
  const { beginSkillsTransaction } = await import("./transaction.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "brand-skills-rollback-"));
  roots.push(root);
  const sourceDir = path.join(root, "source");
  await mkdir(path.join(sourceDir, "fde"), { recursive: true });
  await writeFile(path.join(sourceDir, "fde/SKILL.md"), "instructions");
  const targets = {
    sourceDir,
    agentsDir: path.join(root, "agents"),
    claudeDir: path.join(root, "claude"),
    codexDir: path.join(root, "codex"),
  };
  await syncSkills({ ...targets, skillNames: ["fde"] });
  const untouched = path.join(targets.agentsDir, "other-fde");
  await mkdir(untouched);
  await writeFile(path.join(untouched, "SKILL.md"), "other instructions");
  const transaction = await beginSkillsTransaction(
    targets,
    { mode: "all" },
    { mode: "custom", skills: [] },
    [{ kind: "delete", name: "fde" }],
  );
  const installed = path.join(targets.agentsDir, installedSkillName(brand, "fde"), "SKILL.md");
  await expect(readFile(installed, "utf8")).rejects.toThrow();
  await transaction.rollback();
  expect(await readFile(installed, "utf8")).toBe("instructions");
  expect(await readFile(path.join(untouched, "SKILL.md"), "utf8")).toBe("other instructions");
});
