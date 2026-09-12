import { MicOff } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { OrbArtwork } from "./orb-artwork";
import type { CompanionMicState } from "./store";

const ThemedMicOff = withUnistyles(MicOff, (theme) => ({ color: theme.colors.foregroundMuted }));

interface MicOrbProps {
  state: CompanionMicState;
  /** Capture remains live during reasoning and playback. */
  volume: number;
  speakingVolume?: number;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/** Microphone feedback and the voice's inner light move independently, including while thinking. */
export function MicOrb({
  state,
  volume,
  speakingVolume = 0,
  accessibilityLabel,
  onPress,
  testID,
}: MicOrbProps) {
  const active = state !== "idle";
  const reducedMotion = useReducedMotion();
  const [phase] = useState(() => new Animated.Value(0));
  const [capture] = useState(() => new Animated.Value(0));
  const [playback] = useState(() => new Animated.Value(0));

  useEffect(() => {
    phase.setValue(0);
    if (!active || reducedMotion) return;
    const flow = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 16000,
        isInteraction: false,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    flow.start();
    return () => flow.stop();
  }, [active, reducedMotion, phase]);

  useEffect(() => {
    const levels = Animated.parallel([
      Animated.timing(capture, {
        toValue: active ? volume : 0,
        duration: 100,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(playback, {
        toValue: active ? speakingVolume : 0,
        duration: 100,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]);
    levels.start();
    return () => levels.stop();
  }, [active, volume, speakingVolume, capture, playback]);

  const motion = useMemo(
    () => ({
      halo: {
        opacity: active ? Animated.add(0.7, Animated.multiply(capture, 0.3)) : 0.2,
        transform: [
          { scale: reducedMotion ? 1 : Animated.add(1, Animated.multiply(capture, 0.16)) },
        ],
      },
      sphere: {
        opacity: active ? 1 : 0.35,
        transform: [
          {
            scale: reducedMotion
              ? 1
              : Animated.add(
                  phase.interpolate({
                    inputRange: [0, 0.25, 0.5, 0.75, 1],
                    outputRange: [1, 1.018, 1, 0.982, 1],
                  }),
                  Animated.multiply(capture, 0.06),
                ),
          },
        ],
      },
      cool: {
        transform: [
          { rotate: phase.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
          { scale: reducedMotion ? 1.05 : Animated.add(1.05, Animated.multiply(playback, 0.16)) },
          { translateY: phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 14, 0] }) },
        ],
      },
      warm: {
        opacity: Animated.add(0.7, Animated.multiply(playback, 0.3)),
        transform: [
          { rotate: phase.interpolate({ inputRange: [0, 1], outputRange: ["140deg", "-220deg"] }) },
          { translateX: phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -18, 0] }) },
        ],
      },
    }),
    [active, reducedMotion, capture, playback, phase],
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.pressable}
      testID={testID}
    >
      <Animated.View
        style={[styles.halo, motion.halo]}
        pointerEvents="none"
        testID="companion-input-level"
      >
        <OrbArtwork layer="halo" />
      </Animated.View>
      <Animated.View style={[styles.sphere, motion.sphere]} pointerEvents="none">
        <View style={styles.layer}>
          <OrbArtwork layer="surface" />
        </View>
        <Animated.View style={[styles.layer, motion.cool]} testID="companion-orb-flow">
          <OrbArtwork layer="cool" />
        </Animated.View>
        <Animated.View style={[styles.layer, motion.warm]}>
          <OrbArtwork layer="warm" />
        </Animated.View>
        <View style={styles.layer}>
          <OrbArtwork layer="glass" />
        </View>
      </Animated.View>
      {!active ? (
        <View style={styles.mutedGlyph}>
          <ThemedMicOff size={24} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressable: { width: 256, height: 248, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 256, height: 256 },
  sphere: {
    width: 184,
    height: 184,
    borderRadius: 92,
    overflow: "hidden",
    backgroundColor: "#263057",
  },
  layer: { position: "absolute", top: 0, left: 0, width: 184, height: 184 },
  mutedGlyph: {
    position: "absolute",
    padding: 12,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
  },
}));
