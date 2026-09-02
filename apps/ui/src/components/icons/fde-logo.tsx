import { Image } from "react-native";

const LOGO_SOURCE = require("../../../assets/images/icon.png");

interface FdeLogoProps {
  size?: number;
  /** Kept for API compatibility with tinted icon components; the FDE mark is a full-colour raster and ignores it. */
  color?: string;
}

export function FdeLogo({ size = 64 }: FdeLogoProps) {
  return (
    <Image
      source={LOGO_SOURCE}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="FDE"
    />
  );
}
