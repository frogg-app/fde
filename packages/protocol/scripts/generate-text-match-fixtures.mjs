/**
 * Emits ranking fixtures from the TypeScript matcher for the Rust port to be
 * checked against.
 *
 * The Rust implementation in `apps/daemon-rs/src/search/text_match.rs` has to
 * rank *identically*, not just similarly: the daemon and the app's pickers sort
 * the same lists, so a different order is a visible behaviour change. Unit
 * tests written by hand on both sides would agree by construction; these do not.
 *
 * Deterministic: a fixed seed, so regenerating produces the same file and CI can
 * diff it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(packageRoot, "generated/text-match-fixtures.json");

const {
  scoreMatch,
  scorePathMatch,
  scoreTextFields,
  fuzzyPolicyForToken,
  compareMatchScores,
  tokenizeQuery,
} = await import(resolve(packageRoot, "dist/search/text-match.js"));

/** mulberry32: small, seeded, and identical run to run. */
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20260904);
const pick = (list) => list[Math.floor(random() * list.length)];

// Drawn from shapes the daemon actually ranks: paths, branch names, agent
// titles, and the awkward cases (unicode, separators, repeated characters).
const WORDS = [
  "src",
  "apps",
  "packages",
  "server",
  "daemon",
  "protocol",
  "ui",
  "cli",
  "main",
  "index",
  "config",
  "configuration",
  "workspace",
  "worktree",
  "README",
  "test",
  "utils",
  "components",
  "Cargo",
  "node_modules",
  "café",
  "naïve",
  "日本語",
  "emoji😀name",
  "UPPER",
  "MiXeD",
  "a-b_c.d",
  "aaa",
  "abab",
  "",
  "x",
];

const PATHS = [
  "apps/ui/src/components/add-host-modal.tsx",
  "packages/server/src/server/session.ts",
  "packages/protocol/src/search/text-match.ts",
  "apps/daemon-rs/src/search/text_match.rs",
  "docs/rust-daemon-plan.md",
  "~/projects/ade/README.md",
  "/home/frogg/.fde/config.json",
  "café/naïve/日本語/emoji😀name.txt",
  "a-b_c.d/UPPER/MiXeD",
  "aaa/abab/aaa",
  "",
];

const QUERIES = [
  "",
  "s",
  "src",
  "SRC",
  "confug",
  "configuration",
  "conf",
  "tsx",
  "text match",
  "pasbab",
  "mian",
  "main",
  "café",
  "日本",
  "😀",
  "a-b",
  "abab",
  "aaa",
  "apps/ui",
  "srccomp",
  "add host",
  "text_match",
  "xyzzy",
  "  spaced  query  ",
  "packages/protocol/src",
  "nonexistent",
];

const cases = [];

function record(kind, input, result) {
  cases.push({ kind, ...input, expected: result ?? null });
}

for (const query of QUERIES) {
  for (const text of [...WORDS, ...PATHS]) {
    for (const subsequence of [undefined, false]) {
      for (const typoTolerant of [false, true]) {
        const fuzzy = typoTolerant ? fuzzyPolicyForToken(query) : null;
        record(
          "scoreMatch",
          { query, text, subsequence: subsequence ?? null, fuzzy: fuzzy ?? null },
          scoreMatch(query, text, { fuzzy, subsequence }),
        );
      }
    }
    record("scorePathMatch", { query, text }, scorePathMatch(query, text));
  }
}

// Randomised pairs, to reach shapes the curated list does not think of.
for (let index = 0; index < 4000; index += 1) {
  const query = `${pick(WORDS)}${random() < 0.3 ? pick(["/", "-", " ", ""]) : ""}${
    random() < 0.5 ? pick(WORDS) : ""
  }`.slice(0, 24);
  const text = random() < 0.5 ? pick(PATHS) : `${pick(WORDS)}/${pick(WORDS)}/${pick(WORDS)}`;
  const typoTolerant = random() < 0.5;
  const fuzzy = typoTolerant ? fuzzyPolicyForToken(query) : null;
  record(
    "scoreMatch",
    { query, text, subsequence: null, fuzzy: fuzzy ?? null },
    scoreMatch(query, text, { fuzzy }),
  );
  record("scorePathMatch", { query, text }, scorePathMatch(query, text));
}

// Multi-field scoring, which aggregates across tokens and has its own fallback.
for (const query of QUERIES) {
  const fields = [pick(PATHS), pick(WORDS), pick(WORDS)];
  for (const typoTolerant of [false, true]) {
    record(
      "scoreTextFields",
      { query, fields, typoTolerant, subsequence: null },
      scoreTextFields(query, fields, { typoTolerant }),
    );
  }
}

// Ordering: the property that actually matters, since these scores exist to sort.
const orderings = [];
for (const query of ["src", "config", "main", "text match", "aaa"]) {
  const scored = PATHS.map((path) => ({ path, score: scorePathMatch(query, path) }))
    .filter((entry) => entry.score)
    .sort((a, b) => compareMatchScores(a.score, b.score));
  orderings.push({ query, ranked: scored.map((entry) => entry.path) });
}

const document = {
  note: "Generated from packages/protocol/src/search/text-match.ts. Do not edit.",
  tokenizations: QUERIES.map((query) => ({ query, tokens: tokenizeQuery(query) })),
  policies: [...new Set([...WORDS, ...QUERIES])].map((token) => ({
    token,
    policy: fuzzyPolicyForToken(token) ?? null,
  })),
  cases,
  orderings,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document)}\n`);
process.stdout.write(`Wrote ${output} (${cases.length} cases)\n`);
