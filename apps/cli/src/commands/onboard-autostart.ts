import { cancel, confirm, isCancel, log } from "@clack/prompts";

import { installLoginService, uninstallLoginService } from "./daemon/service/install.js";

/**
 * "Start the FDE daemon automatically when you log in?" — the same code as
 * `fde daemon install-service`. Interactive runs are asked (default yes);
 * non-interactive runs honour FDE_AUTOSTART=0|1 and otherwise change nothing.
 */
export function resolveNonInteractiveAutostart(env: NodeJS.ProcessEnv): boolean | null {
  const raw = env.FDE_AUTOSTART?.trim().toLowerCase();
  if (raw === undefined || raw === "") return null;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return null;
}

export async function configureAutostart(args: {
  listen: string;
  home: string | undefined;
  richUi: boolean;
}): Promise<void> {
  let wanted: boolean | null;
  if (args.richUi) {
    const answer = await confirm({
      message: "Start the FDE daemon automatically when you log in?",
      active: "Yes",
      inactive: "No",
      initialValue: true,
    });
    if (isCancel(answer)) {
      cancel("Onboarding cancelled.");
      process.exit(0);
    }
    wanted = answer;
  } else {
    wanted = resolveNonInteractiveAutostart(process.env);
  }

  if (wanted === null) return;
  const result = wanted
    ? installLoginService({ listen: args.listen, home: args.home })
    : uninstallLoginService({ home: args.home });
  log.message(result.message);
  for (const hint of result.hints) log.message(hint);
}
