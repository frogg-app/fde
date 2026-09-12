import { memo, useId } from "react";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";

// Open, translucent light fields. Nothing clips them into a microphone badge.
export const OrbArtwork = memo(function OrbArtwork({
  layer,
}: {
  layer: "halo" | "surface" | "cool" | "warm" | "glass";
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const light = `url(#${id})`;
  const ribbon = `url(#${id}r)`;
  if (layer === "halo") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 240 240">
        <Defs>
          <RadialGradient id={id}>
            <Stop offset="0" stopColor="#68dfff" stopOpacity="0.32" />
            <Stop offset="0.5" stopColor="#9770ff" stopOpacity="0.18" />
            <Stop offset="1" stopColor="#717cff" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx="120" cy="120" rx="120" ry="112" fill={light} />
        {Array.from({ length: 18 }, (_, i) => {
          const angle = i * 2.39996;
          const radius = 83 + (i % 4) * 7;
          return (
            <Circle
              key={i}
              cx={120 + Math.cos(angle) * radius}
              cy={120 + Math.sin(angle) * radius}
              r={i % 3 === 0 ? 1.2 : 0.65}
              fill={i % 2 ? "#8eeaff" : "#beafff"}
              opacity={0.25 + (i % 4) * 0.12}
            />
          );
        })}
      </Svg>
    );
  }
  if (layer === "surface") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 240 240">
        <Defs>
          <RadialGradient id={id} cx="46%" cy="42%" r="53%">
            <Stop offset="0" stopColor="#f0fdff" stopOpacity="0.95" />
            <Stop offset="0.2" stopColor="#a0e2ff" stopOpacity="0.85" />
            <Stop offset="0.48" stopColor="#7b9eff" stopOpacity="0.65" />
            <Stop offset="0.75" stopColor="#835ce9" stopOpacity="0.26" />
            <Stop offset="1" stopColor="#8164ed" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Path
          d="M42 106 C25 51 87 24 132 42 C168 18 211 68 193 113 C222 151 177 213 132 195 C90 219 32 183 43 140 C32 129 34 116 42 106Z"
          fill={light}
        />
        <Ellipse cx="112" cy="116" rx="67" ry="76" fill={light} opacity="0.65" />
      </Svg>
    );
  }
  if (layer === "glass") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 240 240">
        <Defs>
          <LinearGradient id={id} x1="0%" y1="10%" x2="100%" y2="90%">
            <Stop offset="0" stopColor="#8aeaff" stopOpacity="0" />
            <Stop offset="0.3" stopColor="#e6ffff" stopOpacity="0.72" />
            <Stop offset="0.58" stopColor="#cbc5ff" stopOpacity="0.22" />
            <Stop offset="0.83" stopColor="#e8c7ff" stopOpacity="0.66" />
            <Stop offset="1" stopColor="#f5c4ec" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path
          d="M31 135 C42 54 115 34 169 74 C224 116 169 179 122 151 C70 119 79 69 135 56"
          fill="none"
          stroke={light}
          strokeWidth="0.85"
        />
        <Path
          d="M35 149 C65 196 174 184 196 99 C208 46 127 49 98 91 C67 135 124 198 174 174"
          fill="none"
          stroke={light}
          strokeWidth="1.2"
        />
        <Path
          d="M58 82 C112 26 193 92 178 151 C162 212 71 161 65 127"
          fill="none"
          stroke={light}
          strokeWidth="0.6"
        />
      </Svg>
    );
  }
  const cool = layer === "cool";
  return (
    <Svg width="100%" height="100%" viewBox="0 0 240 240">
      <Defs>
        <RadialGradient id={id}>
          <Stop offset="0" stopColor={cool ? "#edffff" : "#fff0fb"} stopOpacity="0.88" />
          <Stop offset="0.28" stopColor={cool ? "#52e9ff" : "#eaaaed"} stopOpacity="0.7" />
          <Stop offset="0.65" stopColor={cool ? "#4798ff" : "#ab70ff"} stopOpacity="0.34" />
          <Stop offset="1" stopColor={cool ? "#5479ef" : "#7651dc"} stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={`${id}r`} x1="10%" y1="0%" x2="85%" y2="100%">
          <Stop offset="0" stopColor={cool ? "#87ffff" : "#ffc9f1"} stopOpacity="0" />
          <Stop offset="0.3" stopColor={cool ? "#7aeaff" : "#e2b8ff"} stopOpacity="0.7" />
          <Stop offset="0.55" stopColor={cool ? "#d0ffff" : "#f5dfff"} stopOpacity="0.28" />
          <Stop offset="0.82" stopColor={cool ? "#4589ff" : "#9979ff"} stopOpacity="0.65" />
          <Stop offset="1" stopColor="#7975ef" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Ellipse cx="85" cy="103" rx="75" ry="87" fill={light} />
      <Ellipse cx="155" cy="146" rx="67" ry="58" fill={light} />
      <Path
        d="M48 80 C87 25 192 48 187 110 C183 149 109 196 67 163 C33 136 63 101 108 97 C168 91 177 124 151 158 C204 113 161 65 112 64 C84 64 61 71 48 80Z"
        fill={ribbon}
      />
      <Path
        d="M48 80 C87 25 192 48 187 110 C183 149 109 196 67 163 C33 136 63 101 108 97"
        fill="none"
        stroke={ribbon}
        strokeWidth="1.3"
      />
      <Path
        d="M65 63 C32 116 87 193 152 174 C202 159 187 89 151 68 C117 48 83 92 98 126 C112 160 149 144 166 124 C145 162 103 163 77 133 C60 111 58 82 65 63Z"
        fill={ribbon}
        opacity="0.7"
      />
    </Svg>
  );
});
