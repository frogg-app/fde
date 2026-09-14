import nebulaSource from "@/assets/images/companion-nebula.png";
import { useMemo } from "react";
import { Image } from "react-native";

interface NebulaProps {
  size: number;
  active: boolean;
  muted: boolean;
  volume: number;
  speakingVolume: number;
  animated: boolean;
}

/** Web keeps a single lightweight fallback; native uses the live Skia shader. */
export function Nebula({ size }: NebulaProps) {
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  return <Image accessibilityIgnoresInvertColors source={nebulaSource} style={style} />;
}
