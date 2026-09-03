import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ICON_SIZE } from "@/styles/theme";

/** Staggered so the bars never move as one block. */
const BAR_DELAYS_MS = [0, 140, 60, 220];
const BAR_KEYS = ["a", "b", "c", "d"];
const BAR_DURATION_MS = 320;
const BAR_MIN_SCALE = 0.3;

interface AudioWaveIconProps {
  size?: number;
  testID?: string;
}

/** Bars pulsing while a spoken alert plays; the visual stand-in for a stop button. */
export function AudioWaveIcon({ size = ICON_SIZE.md, testID }: AudioWaveIconProps) {
  const scales = useRef(BAR_DELAYS_MS.map(() => new Animated.Value(BAR_MIN_SCALE))).current;

  useEffect(() => {
    const animations = scales.map((scale, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(BAR_DELAYS_MS[index]),
          Animated.timing(scale, {
            toValue: 1,
            duration: BAR_DURATION_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: BAR_MIN_SCALE,
            duration: BAR_DURATION_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    for (const animation of animations) {
      animation.start();
    }
    return () => {
      for (const animation of animations) {
        animation.stop();
      }
    };
  }, [scales]);

  const bars = useMemo(
    () =>
      scales.map((scale, index) => ({
        key: BAR_KEYS[index],
        style: [styles.bar, { height: size, transform: [{ scaleY: scale }] }],
      })),
    [scales, size],
  );

  return (
    <View style={[styles.row, { height: size }]} testID={testID}>
      {bars.map((bar) => (
        <Animated.View key={bar.key} style={bar.style} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  bar: {
    width: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
  },
}));
