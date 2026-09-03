import { note } from "@clack/prompts";
import path from "node:path";

import { describeAccessMode, listLanAddresses, type DaemonAccessMode } from "./daemon/readiness.js";

/**
 * What onboarding prints once the daemon is up: where to reach it, who may
 * connect, and the short command reference. Kept out of onboard.ts so the flow
 * there stays readable.
 */
const plainNoteFormat = (line: string): string => line;

export function renderNote(message: string, title: string): void {
  note(message, title, { format: plainNoteFormat });
}

export function printLines(lines: string[], title: string, richUi: boolean): void {
  if (lines.length === 0) return;
  if (!richUi) {
    console.log("");
    console.log(`${title}:`);
    for (const line of lines) console.log(line);
    return;
  }
  renderNote(lines.join("\n"), title);
}

/**
 * Where to reach this daemon, and who is allowed to. Printed whether or not
 * pairing is needed, because the LAN address is what people type into the app.
 */
export function describeReachability(input: {
  listen: string;
  accessMode: DaemonAccessMode;
  pairingRequired: boolean;
}): string[] {
  const lines = [`Listening on ${input.listen}`];
  const addresses = listLanAddresses(input.listen);
  if (addresses.length > 0) {
    lines.push(`On this network: ${addresses.join("  ")}`);
    lines.push("Type one of those into the FDE app to add this host.");
  } else {
    lines.push(
      "This daemon listens on loopback only. Restart it with --listen 0.0.0.0:9999 to reach it from other devices.",
    );
  }
  lines.push(describeAccessMode(input.accessMode));
  if (input.pairingRequired) {
    lines.push("Pair a device: fde pair");
    lines.push("Or use a password instead: fde daemon set-password");
  }
  return lines;
}

export function printNextSteps(
  pairingUrl: string | null,
  paseoHome: string,
  richUi: boolean,
): void {
  const daemonLogPath = path.join(paseoHome, "daemon.log");
  printLines(
    [
      pairingUrl
        ? "1. Open FDE and scan the QR code above, or paste the pairing link."
        : "1. Open FDE and connect to your daemon.",
      "2. Pairing links open in the FDE desktop app directly (https://pair.frogg.app/code/…).",
      "3. Desktop app: https://github.com/frogg-app/fde/releases/latest",
      "4. Docs: https://paseo.sh/docs",
      '5. Example: fde run --output-schema schema.json "extract fields"',
    ],
    "Next steps",
    richUi,
  );
  printLines(
    [
      "1. fde --help",
      "2. fde ls",
      '3. fde run "your prompt"',
      "4. fde status",
      `5. Daemon logs: ${daemonLogPath}`,
    ],
    "CLI quick reference",
    richUi,
  );
}
