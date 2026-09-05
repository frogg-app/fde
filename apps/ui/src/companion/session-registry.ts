import { createAudioEngine } from "@/voice/audio-engine";
import {
  createCompanionRuntime,
  type CompanionRuntime,
  type CompanionSessionAdapter,
} from "./runtime";
import { useCompanionStore } from "./store";

const adapters = new Map<string, CompanionSessionAdapter>();
let runtime: CompanionRuntime | null = null;

/**
 * One Companion runtime per app, because the Companion is one conversation. Its
 * own capture engine is separate from voice mode's: the two are never in session
 * at the same time, but they own their microphone independently, so sharing one
 * engine would let stopping either one deafen the other.
 */
export function getCompanionRuntime(): CompanionRuntime {
  if (runtime) return runtime;

  let created: CompanionRuntime | null = null;
  const engine = createAudioEngine({
    onCaptureData: (pcm) => created?.handleCapturePcm(pcm),
    onVolumeLevel: (level) => created?.handleCaptureVolume(level),
    onInterruption: () => {
      void created?.stop();
    },
    onError: (error) => {
      console.error("[Companion] Capture error:", error);
    },
  });

  created = createCompanionRuntime({
    engine,
    sink: {
      sessionStarted: () => useCompanionStore.getState().sessionStarted(),
      sessionFailed: (input) => useCompanionStore.getState().sessionFailed(input),
      sessionStopped: () => useCompanionStore.getState().sessionStopped(),
      setMuted: (isMuted) => useCompanionStore.getState().setMuted(isMuted),
      setVolume: (volume) => useCompanionStore.getState().setVolume(volume),
      userSpeakingChanged: (isSpeaking) =>
        useCompanionStore.getState().userSpeakingChanged(isSpeaking),
      transcriptReceived: (input) => useCompanionStore.getState().transcriptReceived(input),
      replyReceived: (input) => useCompanionStore.getState().replyReceived(input),
      companionAudioStarted: () => useCompanionStore.getState().companionAudioStarted(),
      companionAudioFinished: () => useCompanionStore.getState().companionAudioFinished(),
      notebookReceived: (topics) => useCompanionStore.getState().notebookReceived(topics),
      sendPending: (text) => useCompanionStore.getState().sendPending(text),
      sendSucceeded: () => useCompanionStore.getState().sendSucceeded(),
      sendFailed: (reasonCode) => useCompanionStore.getState().sendFailed(reasonCode),
    },
  });

  runtime = created;
  return created;
}

/** Hosts publish their adapter while connected; the Companion binds to one of them. */
export function registerCompanionSession(adapter: CompanionSessionAdapter): () => void {
  adapters.set(adapter.serverId, adapter);
  return () => {
    adapters.delete(adapter.serverId);
  };
}

export function getCompanionSession(serverId: string): CompanionSessionAdapter | null {
  return adapters.get(serverId) ?? null;
}
