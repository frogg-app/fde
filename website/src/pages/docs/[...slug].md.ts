import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { markdownPath, toMarkdown } from "../../lib/docs-markdown";

export const getStaticPaths = (async () => {
  const docs = await getCollection("docs");
  return docs
    .filter((entry) => entry.id === "docs" || entry.id.startsWith("docs/"))
    .map((entry) => ({
      params: { slug: markdownPath(entry.id).replace(/^\/docs\//, "").replace(/\.md$/, "") },
      props: { entry },
    }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ entry: CollectionEntry<"docs"> }> = ({ props }) =>
  new Response(toMarkdown(props.entry), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
