import { spawn } from "node:child_process";
import { resolveExternalCliEntrypoint } from "./entrypoints.js";
import { createNodeEntrypointInvocation, prepareDaemonBundle } from "../runtime-paths.js";

const DESKTOP_CLI_ENV = "PASEO_DESKTOP_CLI";
const IGNORED_ARG_PREFIXES = [
  "-psn_",
  "--class=",
  "--no-sandbox",
  "--remote-debugging-port=",
  "--inspect=",
  "--inspect-brk=",
  "--inspect-publish-uid=",
  "--remote-debugging-pipe",
  "--disable-gpu",
  "--ozone-platform=",
];

export type PassthroughCliRunner = (argv: string[]) => Promise<number>;

export function parsePassthroughCliArgs(input: {
  argv: string[];
  isDefaultApp: boolean;
  forceCli: boolean;
}): string[] | null {
  const startIndex = input.isDefaultApp ? 2 : 1;
  const effective: string[] = [];

  for (const arg of input.argv.slice(startIndex)) {
    if (IGNORED_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix))) {
      continue;
    }
    effective.push(arg);
  }

  if (input.forceCli) {
    return effective;
  }

  return effective.length > 0 ? effective : null;
}

export function parsePassthroughCliArgsFromArgv(argv: string[]): string[] | null {
  return parsePassthroughCliArgs({
    argv,
    isDefaultApp: process.defaultApp,
    forceCli: process.env[DESKTOP_CLI_ENV] === "1",
  });
}

async function runBundledCli(args: string[]): Promise<number> {
  await prepareDaemonBundle();
  const invocation = createNodeEntrypointInvocation({
    entrypoint: resolveExternalCliEntrypoint(),
    argvMode: "node-script",
    args,
    baseEnv: process.env,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export async function runPassthroughCli(
  args: string[],
  options: { runCli?: PassthroughCliRunner } = {},
): Promise<number> {
  const runCli = options.runCli ?? runBundledCli;
  return await runCli(args);
}
