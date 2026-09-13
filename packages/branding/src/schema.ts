import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(48);
const text = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) => [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
    "Control characters are not allowed",
  );
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const url = z.url().refine((value) => {
  const parsed = new URL(value);
  return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
}, "Expected an HTTP(S) URL without credentials");
const palette = z.strictObject({
  accent: color,
  accentForeground: color,
  background: color,
  foreground: color,
  accentBright: color.optional(),
});
const assetPath = z.string().min(1);

export const BrandManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slug,
  name: text,
  applicationId: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/),
  daemonPort: z.number().int().min(1024).max(65535),
  fullName: text.optional(),
  description: text.optional(),
  publisher: text.optional(),
  cliName: slug.optional(),
  desktopBinaryName: slug.optional(),
  homeDir: z
    .string()
    .regex(/^\.[a-z][a-z0-9-]*$/)
    .optional(),
  envPrefix: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  scheme: slug.optional(),
  serviceName: slug.optional(),
  launchdLabel: z
    .string()
    .regex(/^[a-z][a-z0-9.-]*$/)
    .optional(),
  artifactPrefix: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/)
    .optional(),
  assets: z.strictObject({
    icon: assetPath,
    ios: assetPath.optional(),
    foreground: assetPath.optional(),
    notification: assetPath.optional(),
    splash: assetPath.optional(),
    faviconLight: assetPath.optional(),
    faviconDark: assetPath.optional(),
  }),
  colors: z.strictObject({ light: palette.optional(), dark: palette.optional() }).optional(),
  links: z
    .strictObject({
      website: url.optional(),
      support: url.optional(),
      docs: url.optional(),
      source: url.optional(),
      installer: url.optional(),
    })
    .optional(),
  services: z
    .strictObject({
      pairingUrl: url.optional(),
      allowedOrigins: z.array(url).optional(),
    })
    .optional(),
  distribution: z
    .strictObject({
      repository: z
        .string()
        .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
        .optional(),
      updates: z.enum(["disabled", "github-release", "tauri-signed"]).optional(),
      updaterPublicKey: z.string().min(1).optional(),
      dockerImage: z
        .string()
        .regex(/^[a-z0-9][a-z0-9./_-]*$/)
        .optional(),
      pairingImage: z
        .string()
        .regex(/^[a-z0-9][a-z0-9./_-]*$/)
        .optional(),
      iosStoreId: z.string().regex(/^\d+$/).optional(),
      expoProjectId: z.uuid().optional(),
    })
    .optional(),
});
export type BrandManifest = z.infer<typeof BrandManifestSchema>;

export function resolveBrandManifest(input: unknown) {
  const manifest = BrandManifestSchema.parse(input);
  const distribution = resolveDistribution(manifest);
  const repository = distribution.repository;
  const light = manifest.colors?.light ?? {
    accent: "#525252",
    accentForeground: "#ffffff",
    background: "#fafafa",
    foreground: "#171717",
  };
  const dark = manifest.colors?.dark ?? {
    accent: "#a3a3a3",
    accentForeground: "#171717",
    background: "#171717",
    foreground: "#fafafa",
  };
  for (const [appearance, values] of Object.entries({ light, dark })) {
    if (
      contrast(values.accent, values.accentForeground) < 4.5 ||
      contrast(values.background, values.foreground) < 4.5
    ) {
      throw new Error(`${appearance} brand colors require text contrast of at least 4.5:1`);
    }
  }
  return {
    ...resolveIdentity(manifest),
    colors: {
      light: { ...light, accentBright: light.accentBright ?? light.accent },
      dark: { ...dark, accentBright: dark.accentBright ?? dark.accent },
    },
    ...resolveLinksAndServices(manifest, repository),
    distribution,
  };
}
export type Brand = ReturnType<typeof resolveBrandManifest>;

function luminance(value: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const component = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function resolveDistribution(manifest: BrandManifest) {
  const distribution = manifest.distribution ?? {};
  const updateMode =
    distribution.updates ?? (distribution.repository ? "github-release" : "disabled");
  if (updateMode !== "disabled" && !distribution.repository) {
    throw new Error("distribution.repository is required when updates are enabled");
  }
  if (updateMode === "tauri-signed" && !distribution.updaterPublicKey) {
    throw new Error("distribution.updaterPublicKey is required for signed updates");
  }
  const repository = distribution.repository ?? null;
  return {
    repository,
    updateMode,
    updaterPublicKey: distribution.updaterPublicKey ?? null,
    releasesApi: repository ? `https://api.github.com/repos/${repository}/releases` : null,
    releaseBase: repository ? `https://github.com/${repository}/releases` : null,
    dockerImage: distribution.dockerImage ?? null,
    pairingImage: distribution.pairingImage ?? null,
    iosStoreId: distribution.iosStoreId ?? null,
    expoProjectId: distribution.expoProjectId ?? null,
  };
}

function resolveIdentity(manifest: BrandManifest) {
  const id = manifest.id;
  const cliName = manifest.cliName ?? id;
  return {
    schemaVersion: manifest.schemaVersion,
    id,
    name: manifest.name,
    fullName: manifest.fullName ?? manifest.name,
    description: manifest.description ?? `${manifest.name}: run and monitor AI coding agents.`,
    publisher: manifest.publisher ?? manifest.name,
    applicationId: manifest.applicationId,
    daemonPort: manifest.daemonPort,
    cliName,
    desktopBinaryName: manifest.desktopBinaryName ?? (id === "frogg" ? cliName : `${id}-desktop`),
    homeDir: manifest.homeDir ?? `.${id}`,
    envPrefix: manifest.envPrefix ?? id.replaceAll("-", "_").toUpperCase(),
    scheme: manifest.scheme ?? id,
    serviceName: manifest.serviceName ?? `${id}-daemon`,
    launchdLabel: manifest.launchdLabel ?? `${manifest.applicationId}-daemon`,
    artifactPrefix: manifest.artifactPrefix ?? id,
    daemonArtifactPrefix: `${id}-daemon`,
    storagePrefix: id === "frogg" ? "" : `${manifest.applicationId}:`,
    legacyFrogg: id === "frogg",
  };
}

function resolveLinksAndServices(manifest: BrandManifest, repository: string | null) {
  return {
    links: {
      website: manifest.links?.website ?? null,
      docs: manifest.links?.docs ?? null,
      support: manifest.links?.support ?? null,
      source: manifest.links?.source ?? (repository ? `https://github.com/${repository}` : null),
      installer: manifest.links?.installer ?? null,
    },
    services: {
      pairingUrl: manifest.services?.pairingUrl ?? null,
      allowedOrigins: manifest.services?.allowedOrigins ?? [],
    },
  };
}
