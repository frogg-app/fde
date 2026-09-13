import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
const base = process.env.BRANDING_BASE_REF ?? "origin/main";
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const changed = git(["diff", "--name-only", base, "HEAD"]).trim().split("\n").filter(Boolean);
const tracked = git(["ls-files"]).split("\n");
const generated = tracked.filter(
  (file) =>
    /(^|\/)\.generated\//.test(file) ||
    file.startsWith("packages/branding/src/generated/") ||
    file.startsWith(".branding-input/"),
);
if (generated.length)
  throw new Error(`Generated branding must not be committed:\n${generated.join("\n")}`);
if (
  changed.some((file) => file.startsWith("brands/frogg/")) &&
  process.env.ALLOW_OFFICIAL_BRAND_CHANGE !== "1"
) {
  // The initial introduction creates the preset; later edits require explicit review labeling.
  const existed = git(["ls-tree", "--name-only", base, "brands/frogg"]).trim();
  if (existed)
    throw new Error(
      "Official preset changed. Apply the branding:official review label for an intentional Frogg identity/artwork change.",
    );
}
const allowed = new Set(
  JSON.parse(readFileSync(new URL("./branding-literals.json", import.meta.url), "utf8")).map(
    (entry) => entry.literal,
  ),
);
function literals(file, source) {
  const values = new Set();
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      /\b(?:Frogg|Frogg)\b|frogg\.app/.test(node.text)
    )
      values.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return values;
}
const violations = [];
for (const file of changed.filter(
  (candidate) =>
    /^(apps|packages)\//.test(candidate) &&
    /\.[cm]?[jt]sx?$/.test(candidate) &&
    !/\.test\.|\/test[-/]|\/generated\/|^packages\/branding\//.test(candidate),
)) {
  if (!existsSync(file)) continue;
  let previous = "";
  try {
    previous = git(["show", `${base}:${file}`]);
  } catch {
    /* A new source file. */
  }
  const old = literals(file, previous);
  for (const literal of literals(file, readFileSync(file, "utf8"))) {
    if (!old.has(literal) && !allowed.has(literal)) violations.push({ file, literal });
  }
}
if (violations.length) {
  console.error(JSON.stringify(violations, null, 2));
  throw new Error(
    "New product literals need brand values/interpolation, or an exact compatibility/attribution allowlist entry.",
  );
}
console.log("Contribution branding checks passed.");
