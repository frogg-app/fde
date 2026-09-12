import { test } from "node:test";
import assert from "node:assert/strict";
import { portableCommand } from "./npm-command.mjs";
test("Windows npm preserves spaces and shell metacharacters as literal arguments", () => {
  const node = "C:\\Program Files\\nodejs\\node.exe";
  const cli = "C:\\Users\\Build User\\npm\\bin\\npm-cli.js";
  const args = ["run", "build", "--", "--out-dir", "C:\\Acme & Company\\%artwork%"];
  assert.deepEqual(
    portableCommand("npm.cmd", args, {
      platform: "win32",
      execPath: node,
      env: { npm_execpath: cli },
      exists: (p) => p === cli,
    }),
    { command: node, args: [cli, ...args] },
  );
  assert.deepEqual(portableCommand(node, args, { platform: "win32" }), { command: node, args });
});
test("direct Windows builds find npm beside Node; POSIX preserves argv", () => {
  assert.equal(
    portableCommand("npm", [], {
      platform: "win32",
      execPath: "C:\\node\\node.exe",
      env: {},
      exists: () => true,
    }).args[0],
    "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
  );
  assert.deepEqual(portableCommand("npm", ["run", "build"], { platform: "linux" }), {
    command: "npm",
    args: ["run", "build"],
  });
  assert.throws(
    () => portableCommand("npm", [], { platform: "win32", env: {}, exists: () => false }),
    /Cannot locate npm/,
  );
});
