import { stageBrand } from "./stage.mjs";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { outputRoot, root, type BrandBuild } from "./resolve.mjs";
import { writeFile } from "./config.mjs";

const shell = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
export async function generateDeployment({
  brand: b,
  version,
  selected,
}: BrandBuild): Promise<void> {
  const directory = path.join(outputRoot, "deploy");
  await mkdir(directory, { recursive: true });
  const defaults = {
    ID: b.id,
    APPLICATION_ID: b.applicationId,
    NAME: b.name,
    CLI: b.cliName,
    HOME: b.homeDir,
    ENV_PREFIX: b.envPrefix,
    PORT: String(b.daemonPort),
  };
  await writeFile(
    path.join(directory, "runtime.sh"),
    Object.entries(defaults)
      .map(([key, value]) => `BRAND_${key}=${shell(value)}`)
      .join("\n") + "\n",
  );
  const brandInput = await stageBrand(selected);
  const compose = {
    services: {
      [b.id]: {
        image: `${b.distribution.dockerImage ?? b.id}:${version}`,
        build: {
          context: root,
          dockerfile: "deploy/docker/base/Dockerfile",
          args: { FDE_BRAND_DIR: brandInput },
        },
        container_name: b.serviceName,
        ports: [`${b.daemonPort}:${b.daemonPort}`],
        environment: {
          [`${b.envPrefix}_HOME`]: `/home/fde/${b.homeDir}`,
          PASEO_LISTEN: `0.0.0.0:${b.daemonPort}`,
        },
        volumes: [`./${b.id}-state:/home/fde/${b.homeDir}`],
        labels: { "app.brand.id": b.id, "app.brand.application-id": b.applicationId },
        restart: "unless-stopped",
      },
    },
  };
  // JSON is also YAML; avoids a second serialization/escaping implementation.
  await writeFile(path.join(directory, "compose.json"), JSON.stringify(compose, null, 2) + "\n");
  for (const kind of ["pair", "install"] as const) {
    const baseUrl = kind === "pair" ? b.services.pairingUrl : b.links.installer;
    const routes = baseUrl
      ? [{ pattern: `${new URL(baseUrl).hostname}/*`, custom_domain: true }]
      : [];
    // Install scripts share a website: explicit path routes must be configured by its operator.
    const config = {
      name: `${b.id}-${kind === "pair" ? "pair-page" : "install-scripts"}`,
      main: path.join(
        root,
        kind === "pair"
          ? "packages/server/dist/pair-worker/worker.mjs"
          : "packages/server/src/server/install-script-worker.ts",
      ),
      compatibility_date: "2025-09-01",
      observability: { enabled: true },
      ...(kind === "pair" && baseUrl
        ? { routes: routes.map((r) => ({ ...r, pattern: new URL(baseUrl).hostname })) }
        : {}),
      vars:
        kind === "pair"
          ? { FDE_PAIRING_BASE_URL: baseUrl ?? "", FDE_PAIR_ROOT_REDIRECT: b.links.website ?? "" }
          : { FDE_INSTALL_CACHE_SECONDS: "300" },
    };
    await writeFile(
      path.join(directory, `${kind}-worker.json`),
      JSON.stringify(config, null, 2) + "\n",
    );
  }
}
