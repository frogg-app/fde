# Branding manifest reference

The contract is `packages/branding/brand.schema.json`, version `1`. Unknown properties are errors. Asset paths are relative to `brand.json`; other paths are not inferred from Git remotes or directory names.

| Field               | Requirement or default                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| `schemaVersion`     | Required; `1`                                                          |
| `id`                | Required lowercase slug, up to 48 characters                           |
| `name`              | Required public product name; Unicode supported, no control characters |
| `applicationId`     | Required lowercase reverse-DNS identifier with at least three segments |
| `daemonPort`        | Required integer from 1024 through 65535                               |
| `assets.icon`       | Required square PNG/SVG artwork, at least 1024 pixels                  |
| `fullName`          | Defaults to `name`                                                     |
| `description`       | Defaults to a neutral product description                              |
| `publisher`         | Defaults to `name`                                                     |
| `cliName`           | Defaults to `id`                                                       |
| `desktopBinaryName` | Defaults to `<id>-desktop` for custom products; FDE preserves `fde`    |
| `homeDir`           | Defaults to `.<id>`; a dot-prefixed directory name                     |
| `envPrefix`         | Uppercase ID, with hyphens converted to underscores                    |
| `scheme`            | Defaults to `id`                                                       |
| `serviceName`       | Defaults to `<id>-daemon`                                              |
| `launchdLabel`      | Defaults to `<applicationId>-daemon`                                   |
| `artifactPrefix`    | Defaults to `id`                                                       |

The official preset preserves historical FDE naming where it differs, including the `paseo` URL scheme and legacy command alias. FDE/Paseo installation identities are reserved for the official preset. Internal package names, protocol messages, bridge events, SDK symbols, and project files such as `paseo.json` are compatibility contracts and are not manifest options.

## Artwork and colors

Optional `assets` keys are `ios`, `foreground`, `notification`, `splash`, `faviconLight`, and `faviconDark`. Missing variants derive from `icon`. Notification masks, ICO/ICNS output, mobile assets, PWA safe zones, and running/attention favicon indicators are generated locally. The official preset preserves existing artwork.

`colors.light` and `colors.dark` each accept `accent`, `accentForeground`, `background`, and `foreground`, with optional `accentBright`. Colors are six-digit hex values. Foreground/background and accent/foreground pairs must meet 4.5:1 contrast. Neutral palettes apply when custom colors are omitted. These defaults integrate with existing semantic themes; user-selected and plugin themes remain available.

## Links and infrastructure

`links` accepts `website`, `support`, `docs`, `source`, and `installer`. Values are HTTP(S) URLs without embedded credentials. Omitted custom links are unavailable; UI controls with no destination are omitted.

`services` accepts:

- `pairingUrl`: hosted pairing page origin/base URL.
- `relayEndpoint`: explicit relay host and port.
- `relayUseTls`: TLS selection for the configured relay.
- `allowedOrigins`: trusted hosted application origins.

A custom brand inherits none of FDE's pairing, relay, installer, or hosted-app endpoints. Configure infrastructure you operate. Direct connections and native deep links do not require hosted pairing.

## Distribution

`distribution` accepts:

| Field              | Purpose                                                       |
| ------------------ | ------------------------------------------------------------- |
| `repository`       | GitHub `owner/repository` used by release consumers           |
| `updates`          | `disabled`, `github-release`, or `tauri-signed`               |
| `updaterPublicKey` | Public Tauri updater signing key; required for `tauri-signed` |
| `dockerImage`      | Daemon container repository without a version tag             |
| `pairingImage`     | Pairing container repository without a version tag            |
| `iosStoreId`       | Your numeric App Store application ID                         |
| `expoProjectId`    | Your EAS project UUID                                         |

Without a repository, updates default to disabled. With a repository, they default to `github-release`; explicit `disabled` remains available. Enabled updates require a repository. Tauri signed mode requires the public key. Never put private keys or credentials here.

Resolved public output additionally contains release URLs, artifact prefixes, persistence namespaces, compatibility policy, and generated provenance. These derived outputs are not accepted as input manifest keys. Schema changes must preserve the behavior of existing version-1 manifests or introduce a deliberate new schema version.
