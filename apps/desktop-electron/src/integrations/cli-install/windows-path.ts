import { execFileSync } from "node:child_process";
import path from "node:path";

function powershell(script: string, value?: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, FDE_ELECTRON_CLI_PATH_VALUE: value },
  }).trim();
}

function readUserPath(): string {
  return powershell(
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetEnvironmentVariable("Path", "User")',
  );
}

function writeUserPath(value: string): void {
  powershell(
    `
$ErrorActionPreference = "Stop"
[Environment]::SetEnvironmentVariable("Path", $env:FDE_ELECTRON_CLI_PATH_VALUE, "User")
Add-Type -Namespace Fde -Name EnvironmentNotification -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto, SetLastError = true)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);'
$result = [System.UIntPtr]::Zero
[void][Fde.EnvironmentNotification]::SendMessageTimeout([System.IntPtr]0xffff, 0x1a, [System.UIntPtr]::Zero, "Environment", 2, 1000, [ref]$result)
`,
    value,
  );
}

export function windowsPathContains(value: string, directory: string): boolean {
  function normalize(entry: string): string {
    return path.win32
      .normalize(entry.trim().replace(/^"|"$/g, ""))
      .replace(/[\\/]+$/, "")
      .toLowerCase();
  }
  return value.split(";").some((entry) => normalize(entry) === normalize(directory));
}

export function ensureWindowsUserPath(input: {
  directory: string;
  readPath?: () => string;
  writePath?: (value: string) => void;
  env?: NodeJS.ProcessEnv;
}): void {
  const read = input.readPath ?? readUserPath;
  const write = input.writePath ?? writeUserPath;
  const current = read();
  if (!windowsPathContains(current, input.directory)) {
    write(current ? `${current.replace(/;+$/, "")};${input.directory}` : input.directory);
  }
  const env = input.env ?? process.env;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  if (!windowsPathContains(env[pathKey] ?? "", input.directory)) {
    env[pathKey] = `${input.directory};${env[pathKey] ?? ""}`;
  }
}

export function windowsUserPathContains(directory: string): boolean {
  try {
    return windowsPathContains(readUserPath(), directory);
  } catch {
    return false;
  }
}
