import { useTranslation } from "react-i18next";
import { MicOrb } from "./mic-orb";
import { deriveCompanionMicState, useCompanionStore } from "./store";

/** Audio subscriptions remain separate from the host/project labels. */
export function CompanionMiniPresence({ animated = true }: { animated?: boolean }) {
  const { t } = useTranslation();
  const session = useCompanionStore((s) => s.session);
  const isMuted = useCompanionStore((s) => s.isMuted);
  const isThinking = useCompanionStore((s) => s.isThinking);
  const isSpeaking = useCompanionStore((s) => s.isSpeaking);
  const volume = useCompanionStore((s) => s.volume);
  const speakingVolume = useCompanionStore((s) => s.speakingVolume);
  const open = useCompanionStore((s) => s.open);
  return (
    <MicOrb
      animated={animated}
      playbackActive={session.status === "open" && isSpeaking}
      size={44}
      state={deriveCompanionMicState({
        session,
        isMuted,
        isThinking,
        isSpeaking,
      })}
      volume={volume}
      speakingVolume={speakingVolume}
      onPress={open}
      accessibilityLabel={t("companion.actions.resume")}
      testID="companion-mini-presence"
    />
  );
}
