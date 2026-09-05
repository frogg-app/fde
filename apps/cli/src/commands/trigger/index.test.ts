import { describe, expect, it } from "vitest";
import { createTriggerCommand, TRIGGERS_DISABLED_MESSAGE } from "./index.js";
import { createCli } from "../../cli.js";

describe("fde trigger", () => {
  it("replaces hub on the root surface but still answers to it", () => {
    const cli = createCli();
    const names = cli.commands.map((command) => command.name());
    expect(names).toContain("trigger");
    expect(names).not.toContain("hub");

    // Existing scripts must get the explanation, not "unknown command".
    const trigger = cli.commands.find((command) => command.name() === "trigger");
    expect(trigger?.aliases()).toContain("hub");
  });

  it("documents the intended surface so --help still explains the feature", () => {
    const help = createTriggerCommand().helpInformation();
    for (const name of ["login", "connect", "status", "deploy", "logout"]) {
      expect(help).toContain(name);
    }
    expect(help).toContain("disabled");
  });

  it("explains why rather than failing obscurely, and exits non-zero", async () => {
    const written: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalExitCode = process.exitCode;
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await createTriggerCommand().parseAsync(["connect", "https://example.test"], {
        from: "user",
      });
      expect(written.join("")).toContain(TRIGGERS_DISABLED_MESSAGE);
      expect(process.exitCode).toBe(1);
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = originalExitCode;
    }
  });

  it("names the upstream service it no longer connects to", () => {
    // The point of the message: say what stopped, and what it used to reach.
    expect(TRIGGERS_DISABLED_MESSAGE).toContain("hub.paseo.sh");
    expect(TRIGGERS_DISABLED_MESSAGE).toContain("ROADMAP");
  });
});

describe("fde permissions", () => {
  it("replaces permit while keeping it as an alias", () => {
    const cli = createCli();
    const names = cli.commands.map((command) => command.name());
    expect(names).toContain("permissions");
    expect(names).not.toContain("permit");

    const permissions = cli.commands.find((command) => command.name() === "permissions");
    expect(permissions?.aliases()).toContain("permit");
    expect(permissions?.commands.map((c) => c.name()).sort()).toEqual(["allow", "deny", "ls"]);
  });
});
