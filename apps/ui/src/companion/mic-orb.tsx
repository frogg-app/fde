import { AudioLines, Mic, MicOff } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { CompanionMicState } from "./store";

const ORB_SIZE = 88;
const RING_SIZE = 128;
/** How far the ring grows at full volume. Small on purpose: a ring that leaps reads as noise. */
const RING_GAIN = 0.34;

const ThemedMic = withUnistyles(Mic, (theme) => ({ color: theme.colors.accentForeground }));
const ThemedMicOff = withUnistyles(MicOff, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedAudioLines = withUnistyles(AudioLines, (theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.accentForeground,
}));

interface MicOrbProps {
  state: CompanionMicState;
  /** Smoothed capture level, 0–1. */
  volume: number;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/**
 * The one accent element on the Companion surface. Everything else on the sheet
 * stays neutral so the orb alone carries what the Companion is doing: the fill
 * says the state, the ring says how loudly you are talking.
 */
export function MicOrb({ state, volume, accessibilityLabel, onPress, testID }: MicOrbProps) {
  const isQuiet = state === "idle";
  const ringScale = state === "listening" ? 1 + volume * RING_GAIN : 1;

  const ringStyle = useMemo(
    () => [
      styles.ring,
      isQuiet ? styles.ringQuiet : styles.ringLive,
      inlineUnistylesStyle({ transform: [{ scale: ringScale }] }),
    ],
    [isQuiet, ringScale],
  );

  const orbStyle = useMemo(
    () => [styles.orb, isQuiet ? styles.orbQuiet : styles.orbLive],
    [isQuiet],
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={ORB_ACCESSIBILITY_STATE[state]}
      style={styles.pressable}
      testID={testID}
    >
      <View style={ringStyle} pointerEvents="none" />
      <View style={orbStyle}>
        <OrbGlyph state={state} />
      </View>
    </Pressable>
  );
}

function OrbGlyph({ state }: { state: CompanionMicState }) {
  if (state === "thinking") {
    return <ThemedSpinner size="small" />;
  }
  if (state === "speaking") {
    return <ThemedAudioLines size={ORB_GLYPH_SIZE} strokeWidth={2} />;
  }
  if (state === "idle") {
    return <ThemedMicOff size={ORB_GLYPH_SIZE} strokeWidth={2} />;
  }
  return <ThemedMic size={ORB_GLYPH_SIZE} strokeWidth={2} />;
}

const ORB_GLYPH_SIZE = 28;

const ORB_ACCESSIBILITY_STATE: Record<CompanionMicState, { busy: boolean; disabled: boolean }> = {
  idle: { busy: false, disabled: false },
  listening: { busy: false, disabled: false },
  thinking: { busy: true, disabled: false },
  speaking: { busy: true, disabled: false },
};

const styles = StyleSheet.create((theme) => ({
  pressable: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
  },
  ringLive: {
    borderColor: theme.colors.accent,
    opacity: 0.4,
  },
  ringQuiet: {
    borderColor: theme.colors.border,
    opacity: 0.6,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  orbLive: {
    backgroundColor: theme.colors.accent,
  },
  orbQuiet: {
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
}));
