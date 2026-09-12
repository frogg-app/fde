import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { buildSshArgs, type SshTarget } from "./args.js";

export interface ExecutionInput {
  target: SshTarget;
  command: string;
  script: string;
  signal: AbortSignal;
  timeoutMs: number;
  onLine?(stream: "stdout" | "stderr", text: string): void;
}
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
export type ExecuteScript = (input: ExecutionInput) => Promise<ExecutionResult>;
export interface PasswordEnvironment {
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}
interface ExecutorOptions {
  passwordEnvironment(password?: string): Promise<PasswordEnvironment>;
  spawn?: (
    program: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => ChildProcessWithoutNullStreams;
  programs?: string[];
}
export function sshPrograms(platform = process.platform, env = process.env): string[] {
  if (platform !== "win32") return ["ssh"];
  const windows = env.SystemRoot || env.WINDIR || "C:\\Windows";
  return [
    path.win32.join(windows, "System32", "OpenSSH", "ssh.exe"),
    path.win32.join(windows, "Sysnative", "OpenSSH", "ssh.exe"),
    "ssh.exe",
  ];
}

export function createScriptExecutor(options: ExecutorOptions): ExecuteScript {
  const launch =
    options.spawn ??
    ((program, args, env) => spawn(program, args, { env, windowsHide: true, stdio: "pipe" }));
  return async (input) => {
    input.signal.throwIfAborted();
    const credentials = await options.passwordEnvironment(input.target.sshPassword);
    try {
      input.signal.throwIfAborted();
      const programs = options.programs ?? sshPrograms();
      for (const [index, program] of programs.entries()) {
        try {
          return await execute(
            launch(program, buildSshArgs(input.target, input.command), credentials.env),
            input,
          );
        } catch (error) {
          if (
            !(error && typeof error === "object" && "code" in error && error.code === "ENOENT") ||
            index === programs.length - 1
          )
            throw error;
        }
      }
      throw new Error("ssh not found");
    } finally {
      credentials.cleanup();
    }
  };
}

function execute(
  child: ChildProcessWithoutNullStreams,
  input: ExecutionInput,
): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let abortError: Error | null = null;
    let killDeadline: ReturnType<typeof setTimeout> | undefined;
    const output = { stdout: "", stderr: "" };
    const timeout = setTimeout(
      () => stop(new Error(`SSH command timed out after ${input.timeoutMs / 1000} s.`)),
      input.timeoutMs,
    );
    const finish = (error?: Error, code: number | null = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(killDeadline);
      input.signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve({ ...output, code });
    };
    const stop = (error: Error) => {
      if (finished || abortError) return;
      abortError = error;
      child.kill("SIGKILL");
      killDeadline = setTimeout(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        finish(error);
      }, 3000);
      killDeadline.unref();
    };
    const cancel = () => stop(new Error("Cancelled"));
    input.signal.addEventListener("abort", cancel, { once: true });
    if (input.signal.aborted) cancel();
    for (const stream of ["stdout", "stderr"] as const) {
      const decoder = new StringDecoder("utf8");
      let pending = "";
      const consume = (text: string) => {
        output[stream] = (output[stream] + text).slice(-65536);
        pending += text;
        while (pending.includes("\n") || pending.length > 16384) {
          const newline = pending.indexOf("\n");
          const boundary = newline >= 0 && newline < 16384 ? newline : 16384;
          input.onLine?.(stream, pending.slice(0, boundary).replace(/\r$/u, ""));
          pending = pending.slice(boundary + (newline === boundary ? 1 : 0));
        }
      };
      child[stream].on("data", (chunk: Buffer) => consume(decoder.write(chunk)));
      child[stream].on("end", () => {
        consume(decoder.end());
        if (pending) input.onLine?.(stream, pending);
      });
    }
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(abortError ?? undefined, code));
    // Early remote exit produces EPIPE: the SSH exit status supplies the useful error.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input.script);
  });
}
