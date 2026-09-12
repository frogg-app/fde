import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** The password stays in the SSH child's environment, never argv or a file. */
export async function createSshPasswordEnvironment(password?: string): Promise<{
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}> {
  if (!password) return { env: { ...process.env }, cleanup() {} };
  const directory = await mkdtemp(path.join(tmpdir(), "fde-electron-askpass-"));
  const windows = process.platform === "win32";
  const helper = path.join(directory, windows ? "askpass.cmd" : "askpass.sh");
  try {
    await writeFile(
      helper,
      windows
        ? '@echo off\r\npowershell -NoProfile -NonInteractive -Command "[Console]::Out.Write($env:FDE_SSH_PW)"\r\n'
        : '#!/bin/sh\nprintf %s "$FDE_SSH_PW"\n',
      { mode: 0o700 },
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    env: {
      ...process.env,
      SSH_ASKPASS: helper,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: process.env.DISPLAY || "fde",
      FDE_SSH_PW: password,
    },
    cleanup() {
      void rm(directory, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
