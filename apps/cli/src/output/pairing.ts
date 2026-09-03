const ANSI_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

interface PairingInstructions {
  url: string;
  qr: string | null;
  columns?: number;
  /** When set, the same offer as a `paseo://pair#offer=…` link for the desktop app. */
  deepLink?: string | null;
}

function visibleWidth(value: string): number {
  return Math.max(
    ...value
      .replace(ANSI_PATTERN, "")
      .split("\n")
      .map((line) => line.length),
  );
}

function formatQr(qr: string | null, columns: number | undefined): string {
  if (!qr) {
    return "QR code is unavailable. Use the pairing link below.";
  }

  if (columns === undefined) {
    return "QR code not shown because terminal width could not be detected.";
  }

  const width = visibleWidth(qr);
  if (columns <= width) {
    return `QR code not shown. Resize the terminal to at least ${width + 1} columns, then run this command again.`;
  }

  return qr;
}

export function formatPairingInstructions({
  url,
  qr,
  columns,
  deepLink,
}: PairingInstructions): string {
  const deepLinkSection = deepLink
    ? `\nThe FDE desktop app opens the link above directly (Paste pairing link also works). Same offer as an app link:\n${deepLink}\n`
    : "";
  return `\nScan to pair:\n${formatQr(qr, columns)}\n\nPairing link (phone, QR, or paste into the app):\n${url}\n${deepLinkSection}\nTreat this pairing link like a password. Anyone with it can access this daemon.\n`;
}
