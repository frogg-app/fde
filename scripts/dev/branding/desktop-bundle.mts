import { portableCommand } from "../npm-command.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { daemonArtifactName } from "../../../packages/branding/src/artifacts.js";
import { root, outputRoot, type BrandBuild } from "./resolve.mjs";

/** Products without a download service remain usable from their first launch. */
export function prepareEmbeddedDaemon(build: BrandBuild, args: string[]): void {
  if (process.env.FDE_EMBED_DAEMON_ARCHIVE) return;
  if (build.brand.distribution.releaseBase && process.env.FDE_EMBED_DAEMON !== "1") return;
  const tripleIndex = args.indexOf("--target");
  const triple = tripleIndex < 0 ? "" : (args[tripleIndex + 1] ?? "");
  let platform: string = process.platform === "win32" ? "win" : process.platform;
  if (triple.includes("windows")) platform = "win";
  else if (triple.includes("apple")) platform = "darwin";
  else if (triple.includes("linux")) platform = "linux";
  let arch: string = process.arch;
  if (triple) arch = triple.startsWith("aarch64") ? "arm64" : "x64";
  const directory = path.join(outputRoot, "bundles");
  const archive = path.join(
    directory,
    daemonArtifactName(build.brand, build.version, platform, arch),
  );
  if (!existsSync(archive)) {
    function run(script: string, rest: string[] = []) {
      const npm = portableCommand("npm", ["run", script, ...rest]);
      execFileSync(npm.command, npm.args, {
        cwd: root,
        stdio: "inherit",
        env: process.env,
        shell: false,
      });
    }
    run("build:server");
    run("build:daemon-web-ui");
    run("build:daemon-bundle", ["--", "--target", `${platform}-${arch}`, "--out-dir", directory]);
  }
  process.env.FDE_EMBED_DAEMON_ARCHIVE = archive;
}
