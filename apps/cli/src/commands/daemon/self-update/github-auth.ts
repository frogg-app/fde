import { execFile } from "node:child_process";
import { promisify } from "node:util";

type GhTokenCommand = (
  file: string,
  args: string[],
  options: {
    timeout: number;
    maxBuffer: number;
    encoding: "utf8";
    windowsHide: boolean;
    killSignal: "SIGKILL";
  },
) => Promise<{ stdout: string }>;

/** Read an existing login only; never prompt, persist credentials, or surface command output. */
export async function readGitHubCliToken(
  execute: GhTokenCommand = promisify(execFile),
): Promise<string | null> {
  try {
    const result = await execute("gh", ["auth", "token", "--hostname", "github.com"], {
      timeout: 5_000,
      maxBuffer: 16_384,
      encoding: "utf8",
      windowsHide: true,
      killSignal: "SIGKILL",
    });
    return result.stdout.trim() || null;
  } catch {
    // Missing gh, no login, and timeout all leave the original HTTP error actionable.
    return null;
  }
}
