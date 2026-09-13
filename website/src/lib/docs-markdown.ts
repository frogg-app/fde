import type { CollectionEntry } from "astro:content";

type Doc = CollectionEntry<"docs">;

/** `docs/self-hosting/install` -> `/docs/self-hosting/install.md`; `docs` -> `/docs/index.md`. */
export function markdownPath(id: string): string {
  return id === "docs" ? "/docs/index.md" : `/${id}.md`;
}

export function sortDocs(docs: Doc[]): Doc[] {
  const order = (d: Doc) => d.data.sidebar?.order ?? Number.MAX_SAFE_INTEGER;
  return docs
    .filter((d) => d.id === "docs" || d.id.startsWith("docs/"))
    .sort((a, b) => {
      const dirA = a.id.split("/").slice(0, -1).join("/");
      const dirB = b.id.split("/").slice(0, -1).join("/");
      if (a.id === "docs") return -1;
      if (b.id === "docs") return 1;
      return dirA.localeCompare(dirB) || order(a) - order(b) || a.id.localeCompare(b.id);
    });
}

/** Raw page source minus MDX imports/exports, with the title as a heading. */
export function toMarkdown(entry: Doc): string {
  const body = (entry.body ?? "")
    .split("\n")
    .filter((line) => !/^(import|export)\s/.test(line))
    .join("\n")
    .trim();
  const description = entry.data.description ? `\n\n> ${entry.data.description}` : "";
  return `# ${entry.data.title}${description}\n\n${body}\n`;
}
