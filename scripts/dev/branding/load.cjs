const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
let cached;
function loadBrand() {
  if (!cached) {
    execFileSync(
      process.execPath,
      ["--import", "tsx", path.join(root, "scripts/dev/brand.mts"), "prepare"],
      { cwd: root, stdio: "pipe", env: process.env },
    );
    cached = JSON.parse(readFileSync(path.join(root, ".generated/branding/brand.json"), "utf8"));
  }
  return cached;
}
module.exports = { loadBrand };
