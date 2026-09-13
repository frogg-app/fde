import type { CompanionRuntime } from "../session.js";
import { createCompanionApiBackend, createCompanionModelClient } from "./api.js";
import { createCompanionCodexBackend } from "./codex.js";
import { createCompanionCliBackend } from "./cli.js";

export function createCompanionBackendFactory(cwd: string): CompanionRuntime["createBackend"] {
  return ({ config, tools, logger }) => {
    if (config.backend === "api") {
      return createCompanionApiBackend({
        client: createCompanionModelClient(config),
        tools,
        model: config.model,
      });
    }
    const createBackend =
      config.backend === "codex" ? createCompanionCodexBackend : createCompanionCliBackend;
    return createBackend({ model: config.model, tools, cwd, logger });
  };
}
