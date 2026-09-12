import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MicOrb } from "./mic-orb";
import {
  deriveCompanionMicState,
  useCompanionStore,
  type CompanionSession,
  type CompanionMicState,
} from "./store";

/** High-frequency audio levels stay within the voice surface, away from transcript and task rows. */
export function CompanionPresence({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const session = useCompanionStore((state) => state.session);
  const isMuted = useCompanionStore((state) => state.isMuted);
  const volume = useCompanionStore((state) => state.volume);
  const speakingVolume = useCompanionStore((state) => state.speakingVolume);
  const isThinking = useCompanionStore((state) => state.isThinking);
  const isSpeaking = useCompanionStore((state) => state.isSpeaking);
  const micState = deriveCompanionMicState({ session, isMuted, isThinking, isSpeaking });
  const isSessionOpen = session.status === "open";
  let action = "companion.actions.start";
  if (isSessionOpen) action = isMuted ? "companion.actions.unmute" : "companion.actions.mute";
  return (
    <View style={styles.orbRow}>
      <MicOrb
        state={micState}
        volume={volume}
        speakingVolume={speakingVolume}
        accessibilityLabel={t(action)}
        onPress={onPress}
        testID="companion-mic-orb"
      />
      <View style={styles.presence}>
        {micState !== "idle" ? <View style={styles.listeningDot} /> : null}
        <Text style={styles.micStateLabel} testID="companion-mic-state">
          {t(
            isSessionOpen && isMuted
              ? "companion.status.muted"
              : companionStatusLabel(session.status, micState),
          )}
        </Text>
      </View>
      <Text style={styles.activityLabel} testID="companion-response-state">
        {micState === "thinking" || micState === "speaking"
          ? t(`companion.micState.${micState}`)
          : " "}
      </Text>
    </View>
  );
}

function companionStatusLabel(status: CompanionSession["status"], micState: CompanionMicState) {
  if (status === "reconnecting") return "agentPanel.states.reconnecting";
  if (status === "starting" || status === "stopping") return "companion.status.connecting";
  return micState === "idle" ? "companion.micState.idle" : "companion.micState.listening";
}

const styles = StyleSheet.create((theme) => ({
  orbRow: {
    alignItems: "center",
    paddingBottom: theme.spacing[4],
    borderRadius: 24,
    backgroundColor: theme.colors.surface1,
  },
  presence: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  listeningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  micStateLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  activityLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    marginTop: theme.spacing[2],
  },
}));
