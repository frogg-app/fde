import { describe, expect, it } from "vitest";
import { resolveDiscoveredConnectionAction } from "./connection-action";

describe("discovered daemon connection action", () => {
  it.each(["0.3.1", "0.5.9", "v0.5.0", "0.5.0-beta.1"])(
    "requires upgrading pre-0.6 daemon %s before connecting or pairing",
    (version) => {
      expect(resolveDiscoveredConnectionAction({ version, pairingRequired: false })).toBe(
        "upgrade",
      );
      expect(resolveDiscoveredConnectionAction({ version, pairingRequired: true })).toBe("upgrade");
    },
  );

  it.each(["0.6.0", "0.6.7", "0.6.9+build.1", "0.7.0", "1.0.0"])(
    "allows connection to daemon %s in the current namespace",
    (version) => {
      expect(resolveDiscoveredConnectionAction({ version, pairingRequired: false })).toBe(
        "connect",
      );
      expect(resolveDiscoveredConnectionAction({ version, pairingRequired: true })).toBe("pair");
    },
  );

  it.each([null, "", "development", "0.3", "0.3.1-invalid version"])(
    "does not infer incompatibility from unknown version %s",
    (version) => {
      expect(resolveDiscoveredConnectionAction({ version, pairingRequired: null })).toBe("connect");
      expect(resolveDiscoveredConnectionAction({ version, pairingRequired: true })).toBe("pair");
    },
  );
});
