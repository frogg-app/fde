import { createServer } from "node:http";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const installer = path.resolve("deploy/install.sh");

function fixture(t, shell = "bash", overrides = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "fde-path-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bundle = path.join(home, "bundle");
  mkdirSync(path.join(bundle, "bin"), { recursive: true });
  for (const name of ["fde", "fde"]) {
    writeFileSync(path.join(bundle, "bin", name), "#!/bin/sh\necho installed-cli\n", {
      mode: 0o755,
    });
  }
  writeFileSync(
    path.join(bundle, "manifest.json"),
    JSON.stringify({
      version: "0.0.1",
      platform: process.platform === "darwin" ? "darwin" : "linux",
      arch: process.arch,
    }),
  );
  mkdirSync(path.join(bundle, "node/bin"), { recursive: true });
  symlinkSync(process.execPath, path.join(bundle, "node/bin/node"));
  const archive = path.join(home, "bundle.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", home, "bundle"]);
  const env = {
    ...process.env,
    HOME: home,
    SHELL: `/bin/${shell}`,
    PATH: "/usr/bin:/bin",
    ZDOTDIR: "",
    XDG_CONFIG_HOME: "",
    FDE_INSTALL_DIR: path.join(home, "install"),
    FDE_BIN_DIR: path.join(home, "bin space's $literal `text` \\dir"),
    FDE_BUNDLE_FILE: archive,
    FDE_NO_SERVICE: "1",
    FDE_NO_MODIFY_PATH: "0",
    ...overrides,
  };
  return { home, env, run: () => execFileSync("bash", [installer], { env, encoding: "utf8" }) };
}

test("Bash install exposes CLI in new shells and preserves profiles on rerun", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.home, ".bash_profile"), "# existing settings\n");
  f.run();
  const profile = readFileSync(path.join(f.home, ".bash_profile"), "utf8");
  assert.ok(profile.startsWith("# existing settings\n"));
  assert.equal(existsSync(path.join(f.home, ".profile")), false);
  f.run();
  assert.equal(readFileSync(path.join(f.home, ".bash_profile"), "utf8"), profile);
  for (const file of [".bashrc", ".bash_profile"]) {
    const output = execFileSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        '. "$HOME/$1"; fde; . "$HOME/$1"; printf "%s" "$PATH"',
        "bash",
        file,
      ],
      { env: f.env, encoding: "utf8" },
    );
    assert.equal(output, `installed-cli\n${f.env.FDE_BIN_DIR}:/usr/bin:/bin`);
  }
});

test("Bash creates a login profile and prints a usable current-shell command", (t) => {
  const f = fixture(t);
  const output = f.run();
  assert.ok(existsSync(path.join(f.home, ".profile")));
  const command = output.split("\n").find((line) => line.startsWith("[fde]   export PATH="));
  assert.ok(command);
  assert.equal(
    execFileSync("bash", ["-c", `${command.slice(8)}; fde`], { env: f.env, encoding: "utf8" }),
    "installed-cli\n",
  );
});

test("Zsh honors ZDOTDIR", (t) => {
  const f = fixture(t, "zsh");
  f.env.ZDOTDIR = path.join(f.home, "zsh");
  f.run();
  for (const file of [".zshrc", ".zprofile"]) assert.ok(existsSync(path.join(f.env.ZDOTDIR, file)));
});

test("Fish honors XDG_CONFIG_HOME and does not duplicate configuration", (t) => {
  const f = fixture(t, "fish");
  f.env.XDG_CONFIG_HOME = path.join(f.home, "config");
  f.run();
  const file = path.join(f.env.XDG_CONFIG_HOME, "fish/config.fish");
  const config = readFileSync(file, "utf8");
  assert.match(config, /contains -- .*; or set -gx PATH/);
  f.run();
  assert.equal(readFileSync(file, "utf8"), config);
});

test("the native installer listens on every network interface and starts without systemd", async (t) => {
  const f = fixture(t, "bash", { FDE_NO_SERVICE: "0" });
  const shimDir = path.join(f.home, "shim");
  mkdirSync(shimDir);
  writeFileSync(path.join(shimDir, "systemctl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  f.env.PATH = `${shimDir}:/usr/bin:/bin`;
  const service = await daemonFixture(t);
  f.env.FDE_LISTEN = `0.0.0.0:${service.port}`;
  const { stdout: output } = await promisify(execFile)("bash", [installer], { env: f.env });
  const unit = readFileSync(path.join(f.home, ".config/systemd/user/fde-daemon.service"), "utf8");
  assert.ok(unit.includes(`Environment=FDE_LISTEN=0.0.0.0:${service.port}`));
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => !entry.internal && entry.family === "IPv4");
  for (const { address } of addresses) {
    assert.ok(output.includes(`web UI: http://${address}:${service.port}/`));
  }
  assert.ok(!output.includes("<this-hosts-network-address>"));
  assert.match(output, /verified running daemon 0.0.1/);
  assert.match(output, /started the daemon for this login/);
});

for (const shell of ["bash", "fish", "unknown"]) {
  test(`${shell}: opt-out leaves startup files untouched`, (t) => {
    const f = fixture(t, shell, { FDE_NO_MODIFY_PATH: "1" });
    assert.match(f.run(), /to use fde in this terminal, run:/);
    for (const file of [".bashrc", ".profile", ".config"])
      assert.equal(existsSync(path.join(f.home, file)), false);
  });
}

async function daemonFixture(t, version = "0.0.1", health = "ok") {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/api/identity" ? { version, product: "fde" } : { status: health },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port };
}

for (const [version, health, expected] of [
  ["0.3.1", "ok", /daemon reports version 0.3.1, expected 0.0.1/],
  ["0.0.1", "failed", /daemon health check did not report ok/],
]) {
  test(`installer refuses success for daemon ${version} with health ${health}`, async (t) => {
    const service = await daemonFixture(t, version, health);
    const f = fixture(t, "bash", {
      FDE_NO_SERVICE: "0",
      FDE_HEALTH_TIMEOUT: "0.1",
      FDE_LISTEN: `0.0.0.0:${service.port}`,
    });
    const shimDir = path.join(f.home, "shim");
    mkdirSync(shimDir);
    writeFileSync(path.join(shimDir, "systemctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    f.env.PATH = `${shimDir}:/usr/bin:/bin`;
    await assert.rejects(promisify(execFile)("bash", [installer], { env: f.env }), (error) => {
      assert.match(error.stderr, expected);
      assert.doesNotMatch(error.stdout, /verified running daemon|FDE daemon 0.0.1 installed/);
      return true;
    });
  });
}

test("repeat service installation stops the service and detached owner before activation", async (t) => {
  const service = await daemonFixture(t);
  const f = fixture(t, "bash", { FDE_NO_SERVICE: "0", FDE_LISTEN: `0.0.0.0:${service.port}` });
  const shimDir = path.join(f.home, "shim");
  mkdirSync(shimDir);
  f.env.FDE_TEST_COMMAND_LOG = path.join(f.home, "commands");
  writeFileSync(
    path.join(shimDir, "systemctl"),
    '#!/bin/sh\nprintf "systemctl %s\\n" "$*" >> "$FDE_TEST_COMMAND_LOG"\n',
    { mode: 0o755 },
  );
  f.env.PATH = `${shimDir}:/usr/bin:/bin`;
  // Stage the bundle without starting a real host service.
  execFileSync("bash", [installer], { env: { ...f.env, FDE_NO_SERVICE: "1" } });
  writeFileSync(
    path.join(f.env.FDE_INSTALL_DIR, "current/bin/fde"),
    '#!/bin/sh\nprintf "fde %s\\n" "$*" >> "$FDE_TEST_COMMAND_LOG"\n',
    { mode: 0o755 },
  );
  await promisify(execFile)("bash", [installer], { env: f.env });
  assert.equal(
    readFileSync(f.env.FDE_TEST_COMMAND_LOG, "utf8"),
    [
      "systemctl --user daemon-reload",
      "systemctl --user enable fde-daemon",
      "systemctl --user is-active --quiet fde-daemon",
      "systemctl --user stop fde-daemon",
      `fde daemon stop --home ${f.home}/.fde`,
      "systemctl --user start fde-daemon",
      "",
    ].join("\n"),
  );
});
