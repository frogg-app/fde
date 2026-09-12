import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const desktop = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
const allowed = new Set(["electron", ...builtinModules, ...Object.keys(manifest.dependencies)]);

function packageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function runtimeImports(source, filename) {
  const emitted = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ast = ts.createSourceFile(filename, emitted, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}

test("the packaged main process only imports its declared production dependencies", async () => {
  const sourceRoot = path.join(desktop, "src");
  const files = await readdir(sourceRoot, { recursive: true });
  const missing = [];
  for (const filename of files) {
    if (!filename.endsWith(".ts") || filename.endsWith(".test.ts") || filename.endsWith(".d.ts"))
      continue;
    const source = await readFile(path.join(sourceRoot, filename), "utf8");
    for (const specifier of runtimeImports(source, filename)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      if (!allowed.has(packageName(specifier))) missing.push({ filename, specifier });
    }
  }
  assert.deepEqual(missing, [], "Hoisted workspace imports can pass locally but crash app.asar");
});
