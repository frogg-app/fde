import { readdir, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { installedSkillName } from "../../../packages/branding/src/skills.js";
import { writeFile } from "./config.mjs";
import { root, outputRoot, type BrandBuild } from "./resolve.mjs";

/** Transform controlled bundled instructions, never user text or protocol identifiers. */
export async function generateSkills({ brand }: BrandBuild) {
  const source = path.join(root, "skills");
  const names = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  async function copy(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
      const file = path.join(relative, entry.name);
      const target = path.join(outputRoot, "skills", file);
      if (entry.isDirectory()) {
        await copy(file);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported skill asset: ${file}`);
      let text = await readFile(path.join(source, file), "utf8");
      if (!brand.legacyFde && entry.name.endsWith(".md")) {
        for (const name of names.sort((a, b) => b.length - a.length)) {
          const installed = installedSkillName(brand, name);
          text = text
            .replaceAll(`name: ${name}\n`, `name: ${installed}\n`)
            .replaceAll(`**${name}**`, `**${installed}**`)
            .replace(new RegExp(`([/\\$])${name}(?=[\\s\\x60])`, "g"), `$1${installed}`);
        }
        text = text
          .replace(
            /\b(?:paseo|fde)(?= (?:daemon|project|workspace|script|run|send|ls|schedule|heartbeat|provider|--version)\b)/g,
            brand.cliName,
          )
          .replaceAll("~/.paseo", `~/${brand.homeDir}`)
          .replaceAll("~/.fde", `~/${brand.homeDir}`)
          .replaceAll("PASEO_HOME", `${brand.envPrefix}_HOME`)
          .replaceAll("127.0.0.1:9999", `127.0.0.1:${brand.daemonPort}`);
        // Capitalized prose names are presentation; SDK symbols such as usePaseo stay intact.
        text = text.replace(/\b(?:Paseo|FDE)\b/g, () => brand.name);
        // Bundled descriptions are single-line plain YAML. Quote the generated
        // value so punctuation in a public product name cannot alter frontmatter.
        text = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, (header) =>
          header.replace(
            /^description: (.+)$/m,
            (_, description: string) => `description: ${JSON.stringify(description)}`,
          ),
        );
        // The SDK documentation describes the shared technology, not a product service.
        // Instructions can describe the compatibility project; make ownership explicit.
        if (entry.name === "SKILL.md") {
          const end = text.indexOf("\n---", 4);
          if (end >= 0)
            text =
              text.slice(0, end + 4) +
              `\n\nInstalled for ${brand.name}. Use \`${brand.cliName}\` for this product; its state lives in \`~/${brand.homeDir}\`. Shared package names and protocol identifiers remain unchanged.\n` +
              text.slice(end + 4);
        }
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text);
    }
  }
  await copy("");
}
