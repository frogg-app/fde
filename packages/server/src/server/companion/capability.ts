import type { ServerCapabilityState } from "@fde/protocol/messages";

import type { PersistedConfig } from "../persisted-config.js";
import {
  isLocalSpeechRuntimeAvailable,
  resolveCompanionFeatureEnabled,
} from "../speech/speech-config-resolver.js";
import { resolveCompanionModelConfig } from "./model-config.js";

export const COMPANION_DISABLED_MESSAGE = "The Companion is turned off on this daemon.";

export interface CompanionCapabilityInputs {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  /** Whether the Claude Code CLI can back the Companion when no key resolves. */
  claudeCliAvailable: boolean;
  localRuntimeAvailable?: boolean;
}

/**
 * A capability means the runtime can actually hold a conversation, so the flag
 * alone is not enough: with neither an Anthropic key nor the Claude Code CLI
 * the Companion is advertised as unavailable and the app never offers the
 * control.
 */
export function resolveCompanionCapability(
  params: CompanionCapabilityInputs,
): ServerCapabilityState {
  const localRuntimeAvailable = params.localRuntimeAvailable ?? isLocalSpeechRuntimeAvailable();
  const enabled = resolveCompanionFeatureEnabled({
    env: params.env,
    persisted: params.persisted,
    localRuntimeAvailable,
  });
  if (!enabled) {
    return { enabled: false, reason: COMPANION_DISABLED_MESSAGE };
  }
  const model = resolveCompanionModelConfig({
    env: params.env,
    persisted: params.persisted,
    claudeCliAvailable: params.claudeCliAvailable,
  });
  if (model.status === "unavailable") {
    return { enabled: false, reason: model.message };
  }
  return { enabled: true, reason: "" };
}
