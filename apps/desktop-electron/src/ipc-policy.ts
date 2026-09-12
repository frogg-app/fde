export function isTrustedDesktopFrame(input: {
  registered: boolean;
  mainFrame: boolean;
  url: string;
  origin: string;
}): boolean {
  if (!input.registered || !input.mainFrame) return false;
  try {
    const url = new URL(input.url);
    const expected = new URL(input.origin);
    return url.protocol === expected.protocol && url.host === expected.host;
  } catch {
    return false;
  }
}

const DESKTOP_PERMISSIONS = new Set([
  "media",
  "notifications",
  "clipboard-sanitized-write",
  "speaker-selection",
  "local-network",
  "local-network-access",
  "loopback-network",
]);

export function isAllowedDesktopPermission(permission: string): boolean {
  return DESKTOP_PERMISSIONS.has(permission);
}
