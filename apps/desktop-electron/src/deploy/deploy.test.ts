import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { brand } from "@fde/branding";
import {
  buildInstallCommand,
  buildSshArgs,
  parseRequest,
  parseTarget,
  shellQuote,
} from "./args.js";
import { createScriptExecutor, type ExecutionInput } from "./executor.js";
import { DeployManager, type DeployEvent } from "./manager.js";
import { buildProbeScript, parseProbeOutput, PROBE_TEMPLATE } from "./probe.js";
import { deployScript } from "./scripts.js";

const distribution = {
  envPrefix: "CUSTOM",
  daemonPort: 9999,
  releaseBase: "https://example.com/releases",
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("SSH deployment validation and scripts", () => {
  it("quotes remote variables and never puts the password in argv", () => {
    const request = parseRequest(
      {
        host: "user@box",
        sshPort: 2222,
        sshPassword: "private",
        version: "v1.2.3",
        listen: "[::1]:9999",
        method: "docker",
      },
      "0",
      distribution,
    );
    expect(buildInstallCommand(request, distribution)).toBe(
      "CUSTOM_VERSION='1.2.3' CUSTOM_BIND='[::1]' CUSTOM_PORT='9999' bash -s",
    );
    const args = buildSshArgs(request.target, "sh -s");
    expect(args).toContain("NumberOfPasswordPrompts=1");
    expect(args).not.toContain("private");
    expect(args.slice(-4)).toEqual(["-p", "2222", "user@box", "sh -s"]);
    expect(shellQuote("it's $(false)")).toBe("'it'\\''s $(false)'");
  });
  it("rejects option injection, invalid addresses, versions and URLs before launch", () => {
    for (const host of ["", "-oProxyCommand=evil", "a b", "a\0b"])
      expect(() => parseTarget({ host })).toThrow();
    for (const value of [
      { sshPort: 70000 },
      { method: "snap" },
      { version: "1;evil" },
      { listen: ":0" },
      { bundleUrl: "file:///tmp/x" },
      { bundleUrl: "https://u:p@host/file" },
    ]) {
      expect(() => parseRequest({ host: "box", ...value }, "1", distribution)).toThrow();
    }
    expect(parseRequest({ host: "box" }, "1", distribution).listen).toBe("0.0.0.0:9999");
    expect(parseRequest({ host: "box", listen: "127.0.0.1:9999" }, "1", distribution).listen).toBe(
      "127.0.0.1:9999",
    );
  });
  it("ships the same branded checksum and product-ownership installers", () => {
    for (const method of ["native", "docker"] as const) {
      for (const uninstall of [true, false])
        expect(deployScript(method, uninstall)).toContain(brand.applicationId);
    }
    expect(deployScript("native")).toContain(".sha256");
    expect(deployScript("native")).toContain("validate_bundle_identity");
    expect(deployScript("docker", true)).toContain("app.brand.application-id");
    expect(deployScript("docker", true)).toContain("mounted state retained");
    expect(PROBE_TEMPLATE).toBe(
      readFileSync(new URL("../../../../deploy/probe.sh.in", import.meta.url), "utf8"),
    );
    expect(buildProbeScript(brand)).not.toMatch(/@[A-Z_]+@/u);
    expect(buildProbeScript(brand)).toContain(brand.applicationId);
  });
  it("normalizes marker output despite banners and rejects missing reports", () => {
    expect(
      parseProbeOutput(
        'Welcome\nFDE_PROBE {"os":"Darwin","hasFde":{"installed":true,"version":"v1.2.3"}}',
      ).hasFde,
    ).toEqual({ installed: true, version: "1.2.3" });
    expect(() => parseProbeOutput("sh failed")).toThrow("no result");
    expect(() => parseProbeOutput("FDE_PROBE null")).toThrow();
  });
});

describe("deployment jobs", () => {
  it("streams both channels, reports completion once, and forgets completed jobs", async () => {
    const events: DeployEvent[] = [];
    const manager = new DeployManager({
      brand: distribution,
      defaultVersion: "1",
      probeScript: "probe",
      script: () => "installer",
      emit: (event) => events.push(event),
      execute: async (input) => {
        input.onLine?.("stdout", "installing");
        input.onLine?.("stderr", "notice");
        return { stdout: "", stderr: "", code: 0 };
      },
    });
    const { jobId } = manager.start({ host: "box" });
    await tick();
    expect(events.map((event) => event.kind)).toEqual(["log", "log", "done"]);
    expect(manager.cancel({ jobId })).toEqual({ cancelled: false });
  });
  it("cancels queued work and reports a single cancelled terminal event", async () => {
    const events: DeployEvent[] = [];
    const manager = new DeployManager({
      brand: distribution,
      defaultVersion: "1",
      probeScript: "probe",
      script: () => "installer",
      emit: (event) => events.push(event),
      execute: async (input) => {
        input.signal.throwIfAborted();
        return { stdout: "", stderr: "", code: 0 };
      },
    });
    const { jobId } = manager.uninstall({ host: "box", method: "docker" });
    expect(manager.cancel({ jobId })).toEqual({ cancelled: true });
    await tick();
    expect(events).toEqual([{ jobId, kind: "error", detail: "Cancelled", cancelled: true }]);
  });
});

describe("SSH process executor with a local fake remote", () => {
  function executor(source: string) {
    let cleanups = 0;
    const execute = createScriptExecutor({
      passwordEnvironment: async () => ({
        env: { ...process.env },
        cleanup() {
          cleanups++;
        },
      }),
      spawn: () => spawn(process.execPath, ["-e", source], { stdio: "pipe" }),
      programs: ["fake-ssh"],
    });
    const input: ExecutionInput = {
      target: { host: "never-contacted.invalid" },
      command: "sh -s",
      script: "script payload",
      signal: new AbortController().signal,
      timeoutMs: 2000,
    };
    return { execute, input, cleanups: () => cleanups };
  }
  it("pipes stdin, preserves UTF-8 lines, and cleans credentials after exit", async () => {
    const fake = executor(
      "process.stdin.on('data', x=>process.stdout.write(x));process.stdin.on('end', ()=>{process.stdout.write('\\nready ✓\\n');process.stderr.write('notice\\n')})",
    );
    const lines: string[] = [];
    const result = await fake.execute({
      ...fake.input,
      onLine: (stream, line) => lines.push(`${stream}:${line}`),
    });
    expect(result.code).toBe(0);
    expect(lines).toContain("stdout:script payload");
    expect(lines).toContain("stdout:ready ✓");
    expect(lines).toContain("stderr:notice");
    expect(fake.cleanups()).toBe(1);
  });
  it("kills only its fake SSH process on timeout and cancellation", async () => {
    const fake = executor("setInterval(()=>{},1000)");
    await expect(fake.execute({ ...fake.input, timeoutMs: 20 })).rejects.toThrow("timed out");
    const controller = new AbortController();
    const run = fake.execute({ ...fake.input, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(run).rejects.toThrow("Cancelled");
    expect(fake.cleanups()).toBe(2);
  });
});
