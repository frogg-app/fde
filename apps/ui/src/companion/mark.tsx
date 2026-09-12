import { useId } from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/** The quiet launcher counterpart of the animated conversation light field. */
export function CompanionMark({ size = 22 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Defs>
        <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor="#35bdd8" />
          <Stop offset="0.5" stopColor="#8893f4" />
          <Stop offset="1" stopColor="#c66dda" />
        </LinearGradient>
      </Defs>
      <Path
        d="M5 6 C10 0 23 6 20 13 C18 20 6 24 3 16 C0 11 10 7 15 10 C22 15 12 23 7 17 C2 10 9 1 16 4 C23 8 19 19 12 20"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </Svg>
  );
}
