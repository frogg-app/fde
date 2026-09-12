import { useEffect, useMemo, useState } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { OrbArtwork } from "./orb-artwork";
import type { CompanionMicState } from "./store";

interface MicOrbProps {
  state: CompanionMicState;
  size?: number;
  animated?: boolean;
  playbackActive?: boolean;
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
  size = 288,
  animated = true,
  playbackActive = state === "speaking",
  volume,
  speakingVolume = 0,
  accessibilityLabel,
  onPress,
  testID,
}: MicOrbProps) {
  const active = state !== "idle";
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = systemReducedMotion || !animated;
  const flowing = active || playbackActive;
  const [phase] = useState(() => new Animated.Value(0));
  const [drift] = useState(() => new Animated.Value(0));
  const [capture] = useState(() => new Animated.Value(0));
  const [playback] = useState(() => new Animated.Value(0));

  useEffect(() => {
    phase.setValue(0);
    drift.setValue(0);
    if (!flowing || reducedMotion) return;
    const flow = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 16000,
        isInteraction: false,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    const shimmer = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 23000,
        isInteraction: false,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    flow.start();
    shimmer.start();
    return () => {
      flow.stop();
      shimmer.stop();
    };
  }, [flowing, reducedMotion, phase, drift]);

  useEffect(() => {
    const levels = Animated.parallel([
      Animated.timing(capture, {
        toValue: active && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0,
        duration: 100,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(playback, {
        toValue:
          playbackActive && Number.isFinite(speakingVolume)
            ? Math.max(0, Math.min(1, speakingVolume))
            : 0,
        duration: 100,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]);
    levels.start();
    return () => levels.stop();
  }, [active, playbackActive, volume, speakingVolume, capture, playback]);

  const motion = useMemo(
    () => ({
      halo: {
        opacity: active ? Animated.add(0.7, Animated.multiply(capture, 0.3)) : 0.2,
        transform: [
          {
            scale: reducedMotion ? 1 : Animated.add(1, Animated.multiply(capture, 0.16)),
          },
        ],
      },
      sphere: {
        opacity: flowing ? 1 : 0.35,
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
          {
            rotate: phase.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "360deg"],
            }),
          },
          {
            scale: reducedMotion ? 1.05 : Animated.add(1.05, Animated.multiply(playback, 0.16)),
          },
          {
            translateY: phase.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 14, 0],
            }),
          },
        ],
      },
      filaments: {
        transform: [
          {
            rotate: drift.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: ["-16deg", "22deg", "-16deg"],
            }),
          },
          {
            scaleY: drift.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0.94, 1.1, 0.94],
            }),
          },
        ],
      },
      warm: {
        opacity: Animated.add(0.7, Animated.multiply(playback, 0.3)),
        transform: [
          {
            rotate: phase.interpolate({
              inputRange: [0, 1],
              outputRange: ["140deg", "-220deg"],
            }),
          },
          {
            translateX: phase.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, -18, 0],
            }),
          },
        ],
      },
    }),
    [active, flowing, reducedMotion, capture, playback, phase, drift],
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.pressable, { width: size, height: size }]}
      testID={testID}
    >
      <Animated.View
        style={[styles.halo, { width: size, height: size }, motion.halo]}
        pointerEvents="none"
        testID="companion-input-level"
      >
        <OrbArtwork layer="halo" />
      </Animated.View>
      <Animated.View
        style={[styles.sphere, { width: (size * 8) / 9, height: (size * 8) / 9 }, motion.sphere]}
        pointerEvents="none"
      >
        <View style={styles.layer}>
          <OrbArtwork layer="surface" />
        </View>
        <Animated.View style={[styles.layer, motion.cool]} testID="companion-orb-flow">
          <OrbArtwork layer="cool" />
        </Animated.View>
        <Animated.View style={[styles.layer, motion.warm]} testID="companion-output-level">
          <OrbArtwork layer="warm" />
        </Animated.View>
        <Animated.View style={[styles.layer, motion.filaments]} testID="companion-orb-filaments">
          <OrbArtwork layer="glass" />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: 288,
    height: 288,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: { position: "absolute", width: 288, height: 288 },
  sphere: {
    width: 256,
    height: 256,
  },
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
});
