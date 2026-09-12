import { memo } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { OrbArtwork } from "./orb-artwork";

export const ArtworkFade = memo(function ArtworkFade({
  layer,
  muted,
}: {
  layer: "halo" | "surface" | "cool" | "warm" | "glass";
  muted: Animated.Value;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { opacity: muted.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
        ]}
        testID={`companion-art-color-${layer}`}
      >
        <OrbArtwork layer={layer} />
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: muted }]}
        testID={`companion-art-mono-${layer}`}
      >
        <OrbArtwork layer={layer} monochrome />
      </Animated.View>
    </View>
  );
});
