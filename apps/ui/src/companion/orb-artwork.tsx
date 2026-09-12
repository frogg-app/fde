import { memo, useId } from "react";
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from "react-native-svg";

/** Vector light fields, shared by native and web; no bitmap, blur filter or canvas runtime. */
export const OrbArtwork = memo(function OrbArtwork({
  layer,
}: {
  layer: "halo" | "surface" | "cool" | "warm" | "glass";
}) {
  const id = useId().replace(/:/g, "");
  const light = `url(#${id})`;
  if (layer === "halo") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id={id}>
            <Stop offset="0.45" stopColor="#6288ff" stopOpacity="0.28" />
            <Stop offset="0.7" stopColor="#9671ff" stopOpacity="0.13" />
            <Stop offset="1" stopColor="#65dcff" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="100" cy="100" r="100" fill={light} />
      </Svg>
    );
  }
  if (layer === "surface") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id={id} cx="34%" cy="28%" r="85%">
            <Stop offset="0" stopColor="#99cfff" />
            <Stop offset="0.28" stopColor="#486adc" />
            <Stop offset="0.57" stopColor="#392865" />
            <Stop offset="0.82" stopColor="#151b42" />
            <Stop offset="1" stopColor="#101a35" />
          </RadialGradient>
        </Defs>
        <Circle cx="100" cy="100" r="100" fill={light} />
      </Svg>
    );
  }
  if (layer === "glass") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id={id} cx="42%" cy="12%" r="85%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
            <Stop offset="0.48" stopColor="#c6eeff" stopOpacity="0" />
            <Stop offset="0.85" stopColor="#9cf4ff" stopOpacity="0.14" />
            <Stop offset="1" stopColor="#d9ceff" stopOpacity="0.65" />
          </RadialGradient>
        </Defs>
        <Circle cx="100" cy="100" r="99" fill={light} stroke="#d1ebff" strokeOpacity="0.4" />
        <Path
          d="M 23 62 A 84 84 0 0 1 105 16"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.55"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <Path
          d="M 104 190 A 90 90 0 0 0 182 133"
          fill="none"
          stroke="#a5dbff"
          strokeOpacity="0.45"
          strokeWidth="0.8"
        />
      </Svg>
    );
  }
  const cool = layer === "cool";
  return (
    <Svg width="100%" height="100%" viewBox="0 0 200 200">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={cool ? "#e5ffff" : "#ffe7db"} stopOpacity="0.95" />
          <Stop offset="0.28" stopColor={cool ? "#39e3ff" : "#fa72b3"} stopOpacity="0.9" />
          <Stop offset="0.62" stopColor={cool ? "#468aff" : "#a35bef"} stopOpacity="0.7" />
          <Stop offset="1" stopColor={cool ? "#4662ef" : "#773bcc"} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Ellipse cx="62" cy="74" rx="103" ry="76" fill={light} />
      <Ellipse cx="134" cy="150" rx="86" ry="74" fill={light} opacity="0.9" />
      <Path
        d="M -20 120 C 26 162 46 22 104 72 S 165 170 223 74"
        fill="none"
        stroke={light}
        strokeWidth="12"
        opacity="0.16"
      />
      <Path
        d="M -20 120 C 26 162 46 22 104 72 S 165 170 223 74"
        fill="none"
        stroke={light}
        strokeWidth="1"
        opacity="0.5"
      />
    </Svg>
  );
});
