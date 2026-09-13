import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { markdownPath, sortDocs } from "../lib/docs-markdown";

/** https://llmstxt.org index of the docs. The in-app fde-help skill reads this first. */
export const GET: APIRoute = async ({ site }) => {
  const docs = sortDocs(await getCollection("docs"));
  const base = site?.origin ?? "https://frogg.app";
  const lines = [
    "# FDE",
    "",
    "> FDE (Frogg Development Environment) runs and monitors coding agents (Claude Code, Codex, OpenCode and others) on a self-hosted daemon, from desktop, mobile, web and CLI clients.",
    "",
    "Each page below is available as Markdown at the linked URL.",
    "",
    "## Docs",
    "",
    ...docs.map((entry) => {
      const description = entry.data.description ? `: ${entry.data.description}` : "";
      return `- [${entry.data.title}](${base}${markdownPath(entry.id)})${description}`;
    }),
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
