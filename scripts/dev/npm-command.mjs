import path from "node:path";
import { existsSync } from "node:fs";

/** Invoke npm's JS entry point on Windows; cmd.exe cannot safely preserve arbitrary paths. */
export function portableCommand(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || !/^(npm|npx)(\.cmd)?$/i.test(command)) return { command, args };
  const node = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const filename = command.toLowerCase().startsWith("npx") ? "npx-cli.js" : "npm-cli.js";
  const paths = path.win32;
  const candidates = [
    ...(env.npm_execpath && /npm-cli\.js$/i.test(env.npm_execpath)
      ? [paths.join(paths.dirname(env.npm_execpath), filename)]
      : []),
    paths.join(paths.dirname(node), "node_modules", "npm", "bin", filename),
  ];
  const cli = candidates.find(options.exists ?? existsSync);
  if (!cli)
    throw new Error(
      "Cannot locate npm's JavaScript CLI. Use npm run, or install npm alongside Node.",
    );
  return { command: node, args: [cli, ...args] };
}
