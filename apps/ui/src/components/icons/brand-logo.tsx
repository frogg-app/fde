import { useMemo } from "react";
import { Image } from "react-native";

import { brand } from "@frogg/branding";
import { brandAssets } from "../../../.generated/branding/assets";
const LOGO_SOURCE = brandAssets["icon.png"];

interface FroggLogoProps {
  size?: number;
  /** Kept for API compatibility with tinted icon components; the Frogg mark is a full-colour raster and ignores it. */
  color?: string;
}

export function BrandLogo({ size = 64 }: FroggLogoProps) {
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  return (
    <Image
      source={LOGO_SOURCE}
      style={style}
      resizeMode="contain"
      accessibilityLabel={brand.name}
    />
  );
}
