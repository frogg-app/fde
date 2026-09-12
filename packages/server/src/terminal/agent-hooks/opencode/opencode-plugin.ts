import type { AgentHookPluginFileInstallStrategy } from "../agent-hook-installer.js";

export const OPENCODE_PLUGIN_SOURCE = [
  "const STATUS_EVENTS = {",
  '  busy: "session.status.busy",',
  '  retry: "session.status.retry",',
  '  idle: "session.status.idle",',
  "};",
  "",
  "function fdeEventFor(event) {",
  '  if (event?.type === "permission.asked") return "permission.asked";',
  '  if (event?.type === "permission.replied") return "permission.replied";',
  '  if (event?.type !== "session.status") return null;',
  "  return STATUS_EVENTS[event?.properties?.status?.type] ?? null;",
  "}",
  "",
  "function runFdeHook(event) {",
  "  if (!process.env.FDE_TERMINAL_ID) return;",
  "  try {",
  '    const child = Bun.spawn(["fde", "hooks", "opencode", event], {',
  '      stdin: "ignore",',
  '      stdout: "ignore",',
  '      stderr: "ignore",',
  "    });",
  "    void child.exited.catch(() => {});",
  "  } catch {}",
  "}",
  "",
  "export default async () => ({",
  "  event: async ({ event }) => {",
  "    const fdeEvent = fdeEventFor(event);",
  "    if (fdeEvent) runFdeHook(fdeEvent);",
  "  },",
  "});",
  "",
].join("\n");

export function createOpenCodePluginInstallStrategy(): AgentHookPluginFileInstallStrategy {
  return {
    kind: "plugin-file",
    configDir: "opencode",
    configDirBase: "xdg-config",
    configFile: "plugins/fde-terminal-activity.js",
    configDirEnvOverride: "OPENCODE_CONFIG_DIR",
    hookMarker: "fde hooks opencode",
    source: OPENCODE_PLUGIN_SOURCE,
  };
}
