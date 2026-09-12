import { prepareEmbeddedDaemon } from "./branding/desktop-bundle.mjs";
import { createRequire } from "node:module";
import { checkWebBuild } from "./branding/build-output.mjs";
/** Keeps one brand active for the lifetime of a build or dev server. */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { prepareBrand } from "./branding/prepare.mjs";
import { resolveBrand, root, outputRoot } from "./branding/resolve.mjs";
import { acquireLock } from "./branding/locks.mjs";

const args = process.argv.slice(2);
const target = args.shift();
if (!target) throw new Error("Usage: branded-run.mts tauri <args...> | -- <command> <args...>");
const build = resolveBrand();
const release = await acquireLock("build", build);
try {
  process.env.FDE_BRAND_BUILD_OWNER ||= String(process.pid);
  process.env.FDE_BRAND_DIR = build.selected;
  await prepareBrand(build.selected);
  let command: string;
  let cwd = process.cwd();
  if (target === "tauri") {
    command = process.execPath;
    cwd = path.join(root, "apps/desktop");
    const action = args.shift() ?? "build";
    if (action === "build" && !(await checkWebBuild())) {
      execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:ui"], {
        cwd: root,
        stdio: "inherit",
        env: process.env,
        shell: process.platform === "win32",
      });
    }
    if (action === "build") {
      prepareEmbeddedDaemon(build, args);
      await prepareBrand(build.selected);
    }
    args.unshift(
      createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js"),
      action,
      "--config",
      path.join(outputRoot, "tauri.conf.json"),
    );
  } else {
    command = target === "--" ? args.shift()! : target;
    if (!command) throw new Error("Missing build command");
  }
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await release();
}
