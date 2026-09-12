import { polyfillCrypto } from "./crypto";
import { polyfillNavigator } from "./navigator";
import { polyfillScreenOrientation } from "./screen-orientation";

// A side-effect module runs before later entry imports evaluate browser-oriented dependencies.
polyfillNavigator();
polyfillCrypto();
polyfillScreenOrientation();
