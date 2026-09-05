/**
 * Generates Rust types for the WebSocket protocol from the JSON Schema that
 * `generate-json-schema.mjs` emits from zod.
 *
 * zod stays the single source of truth. `packages/protocol` is consumed by
 * apps/ui, packages/client and apps/cli - all TypeScript - so making Rust the
 * source would mean generating TS for three consumers. This goes the other way.
 *
 * Written by hand rather than using `typify` because typify panics on this
 * schema: zod emits anonymous `__schema0` definitions with no `title`, and
 * typify unwraps a `None` looking for the name. A bespoke emitter also lets us
 * choose names and serde attributes deliberately.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Rust keywords that cannot be bare field names. */
const RUST_KEYWORDS = new Set([
  "as",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
  "async",
  "await",
  "box",
  "final",
  "macro",
  "override",
  "priv",
  "try",
  "typeof",
  "unsized",
  "virtual",
  "yield",
]);

/**
 * Names that cannot be used for a Rust type or enum variant: `Self` is a
 * keyword in type position, and shadowing the prelude makes generated code
 * confusing to read even where it compiles.
 */
const RESERVED_TYPE_NAMES = new Set([
  "Self",
  "Box",
  "Option",
  "Result",
  "String",
  "Vec",
  "Some",
  "None",
  "Ok",
  "Err",
]);

function safeTypeName(value) {
  return RESERVED_TYPE_NAMES.has(value) ? `${value}Value` : value;
}

function pascal(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function snake(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

/** A field name that is a Rust keyword needs a raw identifier plus a rename. */
function fieldIdent(name) {
  const ident = snake(name) || "field";
  return RUST_KEYWORDS.has(ident) ? `r#${ident}` : ident;
}

class Emitter {
  constructor(definitions) {
    this.definitions = definitions;
    /** name -> rendered Rust item, in insertion order. */
    this.items = new Map();
    this.usedNames = new Set();
  }

  /** Reserves a unique type name, suffixing on collision rather than clobbering. */
  reserve(preferred) {
    let name = safeTypeName(preferred || "Unnamed");
    if (!/^[A-Za-z]/.test(name)) name = `T${name}`;
    let candidate = name;
    let counter = 2;
    while (this.usedNames.has(candidate)) candidate = `${name}${counter++}`;
    this.usedNames.add(candidate);
    return candidate;
  }

  resolve(schema) {
    if (schema && schema.$ref) {
      const key = schema.$ref.replace(/^#\/definitions\//, "");
      return this.definitions[key] ?? {};
    }
    return schema ?? {};
  }

  /** Returns the Rust type for `schema`, emitting named items as needed. */
  typeFor(schema, hint) {
    const node = this.resolve(schema);

    // `type: ["string", "null"]` and friends mean optional.
    if (Array.isArray(node.type)) {
      const inner = node.type.filter((t) => t !== "null");
      if (node.type.includes("null")) {
        return `Option<${this.typeFor({ ...node, type: inner.length === 1 ? inner[0] : inner }, hint)}>`;
      }
    }

    if (node.const !== undefined) return "String";

    // A nested discriminated union - the `session` arm wrapping all 198 session
    // message types is the important one.
    const union = node.oneOf ?? node.anyOf;
    if (isTaggedUnion(union, this)) {
      return this.emitTaggedUnion(union, hint);
    }
    if (Array.isArray(node.enum)) {
      // Enums of strings become Rust enums; mixed-type enums stay dynamic.
      if (node.enum.every((value) => typeof value === "string")) {
        return this.emitStringEnum(node.enum, hint);
      }
      return "serde_json::Value";
    }

    switch (node.type) {
      case "string":
        return "String";
      case "boolean":
        return "bool";
      case "integer":
        return "i64";
      case "number":
        return "f64";
      case "array":
        return `Vec<${this.typeFor(node.items ?? {}, `${hint}Item`)}>`;
      case "object":
        if (!node.properties || Object.keys(node.properties).length === 0) {
          // A bag with no declared shape: keep it dynamic rather than inventing one.
          return "serde_json::Value";
        }
        return this.emitStruct(node, hint);
      default:
        // oneOf/anyOf that is not a tagged union, or an unconstrained schema.
        return "serde_json::Value";
    }
  }

  emitStringEnum(values, hint) {
    const name = this.reserve(pascal(hint));
    const variants = values
      .map((value) => {
        const variant = safeTypeName(pascal(value) || "Empty");
        return `    #[serde(rename = ${JSON.stringify(value)})]\n    ${variant},`;
      })
      .join("\n");
    this.items.set(
      name,
      `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\npub enum ${name} {\n${variants}\n}`,
    );
    return name;
  }

  emitStruct(node, hint) {
    const name = this.reserve(pascal(hint));
    // Reserve the name before recursing so a self-referential schema terminates.
    this.items.set(name, "");
    const required = new Set(node.required ?? []);
    const fields = Object.entries(node.properties)
      .map(([key, property]) => {
        const resolved = this.resolve(property);
        // The discriminator is carried by the enum tag, not repeated as a field.
        if (key === "type" && resolved.const !== undefined) return null;
        const inner = this.typeFor(property, `${name}${pascal(key)}`);
        const optional = !required.has(key);
        const rustType = optional && !inner.startsWith("Option<") ? `Option<${inner}>` : inner;
        const ident = fieldIdent(key);
        const attrs = [];
        if (ident.replace(/^r#/, "") !== key) attrs.push(`rename = ${JSON.stringify(key)}`);
        if (rustType.startsWith("Option<")) attrs.push(`skip_serializing_if = "Option::is_none"`);
        const attr = attrs.length ? `    #[serde(${attrs.join(", ")})]\n` : "";
        return `${attr}    pub ${ident}: ${rustType},`;
      })
      .filter(Boolean)
      .join("\n");
    this.items.set(
      name,
      `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\npub struct ${name} {\n${fields}\n}`,
    );
    return name;
  }

  /** A `oneOf` whose members each pin `type` to a const becomes a tagged enum. */
  emitTaggedUnion(variants, name) {
    const reserved = this.reserve(name);
    this.items.set(reserved, "");
    const rendered = variants
      .map((variant) => {
        const node = this.resolve(variant);
        const tag = node.properties?.type?.const;
        const variantName = safeTypeName(pascal(tag));
        const payloadFields = Object.keys(node.properties ?? {}).filter((key) => key !== "type");
        if (payloadFields.length === 0) {
          return `    #[serde(rename = ${JSON.stringify(tag)})]\n    ${variantName},`;
        }
        const payload = this.emitStruct(node, `${variantName}`);
        return `    #[serde(rename = ${JSON.stringify(tag)})]\n    ${variantName}(${payload}),`;
      })
      .join("\n");
    this.items.set(
      reserved,
      `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n#[serde(tag = "type")]\npub enum ${reserved} {\n${rendered}\n}`,
    );
    return reserved;
  }

  render(header) {
    const body = [...this.items.values()].filter(Boolean).join("\n\n");
    return `${header}\n${body}\n`;
  }
}

function isTaggedUnion(variants, emitter) {
  return (
    Array.isArray(variants) &&
    variants.length > 0 &&
    variants.every((variant) => emitter.resolve(variant).properties?.type?.const !== undefined)
  );
}

async function generate(inputName, rootTypeName) {
  const raw = await readFile(resolve(packageRoot, `generated/${inputName}`), "utf8");
  const schema = JSON.parse(raw);
  const emitter = new Emitter(schema.definitions ?? {});

  const variants = schema.oneOf ?? schema.anyOf;
  if (!isTaggedUnion(variants, emitter)) {
    throw new Error(`${inputName}: root is not a discriminated union`);
  }
  emitter.emitTaggedUnion(variants, rootTypeName);

  const header = `// @generated by packages/protocol/scripts/generate-rust-types.mjs
// Source of truth is the zod schema in packages/protocol/src/messages.ts.
// Do not edit by hand: run \`npm run generate:rust\` in packages/protocol.
#![allow(dead_code, clippy::large_enum_variant, clippy::enum_variant_names)]

use serde::{Deserialize, Serialize};
`;
  return emitter.render(header);
}

// Written straight into the crate that consumes them: one location, compiled
// like any other source, and CI fails if they are stale.
const outputDir = resolve(packageRoot, "../../apps/daemon-rs/src/generated");
await mkdir(outputDir, { recursive: true });

const written = [];
for (const [input, rootType, output] of [
  ["ws-inbound.schema.json", "WsInboundMessage", "inbound.rs"],
  ["ws-outbound.schema.json", "WsOutboundMessage", "outbound.rs"],
]) {
  const code = await generate(input, rootType);
  const path = resolve(outputDir, output);
  await writeFile(path, code);
  written.push(path);
  process.stdout.write(`Wrote ${output} (${(code.length / 1024).toFixed(0)} KB)\n`);
}

// Format as part of generating. Otherwise `cargo fmt --check` and the
// generated-files-are-current check disagree forever: one demands wrapped
// attributes, the other regenerates them unwrapped.
const rustfmt = spawnSync("rustfmt", ["--edition", "2021", ...written], {
  stdio: "inherit",
});
if (rustfmt.error) {
  process.stdout.write("rustfmt not found; generated files left unformatted\n");
} else if (rustfmt.status !== 0) {
  process.exitCode = rustfmt.status ?? 1;
}
