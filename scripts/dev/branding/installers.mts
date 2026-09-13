import { legacyArtifactCutoff } from "../../../packages/branding/src/artifacts.js";
import { writeFile } from "./config.mjs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { root, outputRoot, type BrandBuild } from "./resolve.mjs";

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
/** Remote Bash scripts must use LF even when generated from a Windows checkout. */
export function renderInstallerScript(
  source: string,
  defaults: string,
  applicationId: string,
): string {
  const normalized = source.replaceAll("\r\n", "\n");
  const pattern = /# BEGIN BRAND DEFAULTS[^\n]*\n[\s\S]*?# END BRAND DEFAULTS/;
  if (!pattern.test(normalized)) throw new Error("Installer has no distribution defaults block");
  return normalized.replace(
    pattern,
    () => `# Generated distribution: ${applicationId}\n${defaults}`,
  );
}

export async function generateInstallers(build: BrandBuild): Promise<void> {
  const b = build.brand;
  const fields = {
    ID: b.id,
    NAME: b.name,
    FULL_NAME: b.fullName,
    APPLICATION_ID: b.applicationId,
    ENV_PREFIX: b.envPrefix,
    CLI: b.cliName,
    HOME: b.homeDir,
    SERVICE: b.serviceName,
    LAUNCHD: b.launchdLabel,
    DAEMON_PREFIX: b.daemonArtifactPrefix,
    ARTIFACT_PREFIX: b.artifactPrefix,
    LEGACY_ARTIFACT_CUTOFF: legacyArtifactCutoff,
    PORT: String(b.daemonPort),
    RELEASE_BASE: b.distribution.releaseBase ?? "",
    DOCKER_IMAGE: b.distribution.dockerImage ?? "",
    LEGACY: String(b.legacyFrogg),
  };
  const defaults =
    Object.entries(fields)
      .map(([key, value]) => `BRAND_${key}=${quote(value)}`)
      .join("\n") +
    `\nBRAND_COMMANDS=(${(b.legacyFrogg ? [b.cliName, "frogg"] : [b.cliName]).map(quote).join(" ")})`;
  const scripts: Record<string, string> = {};
  await mkdir(path.join(outputRoot, "scripts"), { recursive: true });
  for (const file of ["install.sh", "uninstall.sh", "install-docker.sh", "uninstall-docker.sh"]) {
    const source = await readFile(path.join(root, "deploy", file), "utf8");
    scripts[`/${file}`] = renderInstallerScript(source, defaults, b.applicationId);
    await writeFile(path.join(outputRoot, "scripts", file), scripts[`/${file}`]);
  }
  const probe = (await readFile(path.join(root, "deploy/probe.sh.in"), "utf8"))
    .replaceAll("\r\n", "\n")
    .replace(
      /@(ID|ENV_PREFIX|CLI|SERVICE|APPLICATION_ID|LEGACY)@/g,
      (_match, key: keyof typeof fields) => fields[key],
    );
  await writeFile(path.join(outputRoot, "scripts/probe.sh"), probe);
  await writeFile(
    path.join(root, "packages/branding/src/generated/installers.ts"),
    `// Generated distribution scripts; intentionally separate from the browser runtime.\nexport const installers: Readonly<Record<string, string>> = ${JSON.stringify(scripts)};\n`,
  );
}
