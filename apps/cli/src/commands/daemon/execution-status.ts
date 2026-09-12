import { createRequire } from "node:module";
import type { Command } from "commander";
import { getExecutionServiceStatus } from "@fde/server";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import { resolveLocalPaseoHome } from "./local-daemon.js";

interface ExecutionStatusResult {
  status: "running" | "stopped";
  home: string;
  installedVersion: string;
  executionVersion: string | null;
  pid: number | null;
  residentAgentCount: number | null;
  message: string;
}

const require = createRequire(import.meta.url);
const schema: OutputSchema<ExecutionStatusResult> = {
  idField: "status",
  columns: [
    { header: "STATUS", field: "status" },
    { header: "INSTALLED", field: "installedVersion" },
    { header: "EXECUTION", field: "executionVersion" },
    { header: "PID", field: "pid" },
    { header: "RESIDENT AGENTS", field: "residentAgentCount" },
    { header: "MESSAGE", field: "message" },
  ],
};

export interface ExecutionStatusDependencies {
  resolveHome: typeof resolveLocalPaseoHome;
  getStatus: typeof getExecutionServiceStatus;
}

const defaultDependencies: ExecutionStatusDependencies = {
  resolveHome: resolveLocalPaseoHome,
  getStatus: getExecutionServiceStatus,
};

export function runExecutionStatusCommand(
  options: CommandOptions,
  command: Command,
  dependencies: ExecutionStatusDependencies,
): Promise<SingleResult<ExecutionStatusResult>>;
export function runExecutionStatusCommand(
  options: CommandOptions,
  command: Command,
): Promise<SingleResult<ExecutionStatusResult>>;
export async function runExecutionStatusCommand(
  options: CommandOptions,
  _command: Command,
  dependencies: ExecutionStatusDependencies = defaultDependencies,
): Promise<SingleResult<ExecutionStatusResult>> {
  const home = dependencies.resolveHome(
    typeof options.home === "string" ? options.home : undefined,
  );
  const execution = await dependencies.getStatus(home);
  const packageJson: { version: string } = require("../../../package.json");
  const message = execution
    ? "Execution survives gateway stop/restart. Resident agents retain this backend version; use stop --all to stop execution."
    : "No independent execution service is running.";
  return {
    type: "single",
    data: {
      status: execution ? "running" : "stopped",
      home,
      installedVersion: packageJson.version,
      executionVersion: execution?.version ?? null,
      pid: execution?.pid ?? null,
      residentAgentCount: execution?.residentAgentCount ?? null,
      message,
    },
    schema,
  };
}
