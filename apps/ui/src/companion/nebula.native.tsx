import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import {
  createNebulaSeed,
  defaultNebulaPalette,
  nebulaDefaults,
  nebulaRgb,
  nebulaSkiaShader,
} from "./nebula-shader";

const effect = Skia.RuntimeEffect.Make(nebulaSkiaShader);

interface NebulaProps {
  size: number;
  active: boolean;
  muted: boolean;
  volume: number;
  speakingVolume: number;
  animated: boolean;
}

/** Native rendering of the same transparent Nebula shader used on frogg.app. */
export function Nebula({ size, active, muted, volume, speakingVolume, animated }: NebulaProps) {
  const clock = useClock();
  const seed = useMemo(createNebulaSeed, []);
  const inputEnergy = useSharedValue(0);
  const outputEnergy = useSharedValue(0);

  useEffect(() => {
    inputEnergy.value = active ? Math.max(0, Math.min(1, volume)) : 0;
    outputEnergy.value = Math.max(0, Math.min(1, speakingVolume));
  }, [active, volume, speakingVolume, inputEnergy, outputEnergy]);

  const uniforms = useDerivedValue(() => ({
    resolution: [size, size],
    seed,
    primary: nebulaRgb(defaultNebulaPalette.primary),
    secondary: nebulaRgb(defaultNebulaPalette.secondary),
    time: animated ? clock.value / 1000 : 0,
    density: nebulaDefaults.density,
    speed: nebulaDefaults.speed,
    cyan: nebulaDefaults.cyan,
    bloom: nebulaDefaults.bloom,
    energy: nebulaDefaults.energy + inputEnergy.value * 0.5 + outputEnergy.value * 0.35,
    muted: muted ? 1 : 0,
    motion: animated && active ? 1 : 0,
  }));

  if (!effect) return null;
  return (
    <Canvas
      opaque={false}
      pointerEvents="none"
      style={[styles.canvas, { width: size, height: size }]}
    >
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: "transparent" },
});
