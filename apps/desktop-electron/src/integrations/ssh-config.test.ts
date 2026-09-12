import { it, expect } from "vitest";
import path from "node:path";
import { readSshConfigHosts } from "./ssh-config.js";

it("lists concrete aliases, first values and one include level without reading identity files", async () => {
  const home = path.resolve("/user");
  const ssh = path.join(home, ".ssh");
  const files = new Map([
    [
      path.join(ssh, "config"),
      'Include conf.d/*.conf\nHost dev staging\n HostName=dev.example\n User "alice"\n Port = 2222\n IdentityFile "~/.ssh/my key"\nHost *.test !excluded\n User nobody\nMatch host dev\n User ignored\nHost dev\n User duplicate\n',
    ],
    [
      path.join(ssh, "conf.d", "work.conf"),
      "Host build\n HostName build.internal\n HostName ignored\nInclude nested.conf\n",
    ],
  ]);
  const reads: string[] = [];
  const hosts = await readSshConfigHosts(home, {
    async read(file) {
      reads.push(file);
      return files.get(file) ?? null;
    },
    async matches() {
      return [path.join(ssh, "conf.d", "work.conf")];
    },
  });
  expect(hosts).toEqual([
    { alias: "build", hostName: "build.internal" },
    {
      alias: "dev",
      hostName: "dev.example",
      user: "alice",
      port: 2222,
      identityFile: "~/.ssh/my key",
    },
    {
      alias: "staging",
      hostName: "dev.example",
      user: "alice",
      port: 2222,
      identityFile: "~/.ssh/my key",
    },
  ]);
  expect(reads).toHaveLength(2);
});
it("returns an empty picker when no SSH config exists", async () => {
  expect(
    await readSshConfigHosts("/missing", { read: async () => null, matches: async () => [] }),
  ).toEqual([]);
});
