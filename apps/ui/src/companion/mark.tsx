import { useMemo } from "react";
import { Image } from "react-native";

const nebulaSource = require("@/assets/images/companion-nebula.png");

/** The approved Companion nebula, scaled down for the composer trigger. */
export function CompanionMark({ size = 22 }: { size?: number }) {
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  return <Image accessibilityIgnoresInvertColors source={nebulaSource} style={style} />;
}
