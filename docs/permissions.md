# Daemon permissions

The daemon authorizes principals with semantic permissions. RPC names and protocol namespaces are not authority.

## Model

```text
principal -> grants
    |
    +-- authenticated by a device or service credential
    `-- opens a session with equal or narrower authority
```

A principal is the durable identity the daemon authorizes. A credential proves that a device or service represents it. Keep them separate so you can rotate credentials, attach more than one device, and revoke a Hub user without inventing daemon user accounts.

A pairing invitation is neither. It is an expiring, single-use exchange that creates a principal and credential with the permissions selected by its issuer.

## Claimed state

A daemon is **unclaimed** while nobody can authenticate to it: no daemon password is
configured (`daemon.auth.password` / `PASEO_PASSWORD`) and `$PASEO_HOME/principals.json`
holds no principal with a credential. The predicate lives in
`packages/server/src/server/access-policy.ts` and is read live, so a change to the file
takes effect without a restart.

What an unclaimed daemon does with a request depends only on where it comes from:

| Client                                         | Unclaimed                                                                  | Claimed                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| Loopback (127.0.0.1, ::1, socket, pipe)        | open, as before (no password, no bearer needed)                            | open unless a password is configured             |
| Private network, `trustLan` on (the default)   | open, like loopback                                                        | open unless a password is configured             |
| Public address, or private with `trustLan` off | web UI serves the claim page; API/WS answer 401                            | bearer required: a device credential or password |
| Relay / Hub                                    | unchanged: the pairing QR public key and Hub enrollment are the credential |

Loopback stays open on purpose: the CLI, the desktop app's sidecar, and a dev daemon all
talk to their own machine's daemon without a password, and the first-run gate must never
lock a single-machine setup out of itself. The client address honors `daemon.trustedProxies`
(default `loopback`) the same way Express's `trust proxy` does, so a reverse proxy on
localhost does not turn LAN visitors into loopback clients.

### Trusted LAN

`daemon.auth.trustLan` (default `true`; `PASEO_TRUST_LAN=0|1` overrides it, and the
environment wins) treats clients on the daemon's own private network exactly like loopback:
no bearer unless a password is configured, no claim page, and `GET /api/identity` answers
`pairingRequired: false` to them. "Private network" is the address the request resolves to
after trusted proxies, when it falls in IPv4 `10/8`, `172.16/12`, `192.168/16`, or
`169.254/16` (link-local), or IPv6 `fc00::/7` (unique-local) or `fe80::/10` (link-local),
including the IPv4-mapped forms (`::ffff:192.168.1.10`). Carrier-grade NAT (`100.64/10`)
and every routable address are public and keep the rules above. Pairing stays available on
a trusted LAN (the app can still claim, `POST /api/setup/offer` still mints credentials),
it is just no longer required; `/api/identity` also reports the mode as `lanTrusted`.

The trade-off is deliberate and worth stating plainly: with `trustLan` on and no password,
**anyone who can reach the daemon on the same private network can control your agents,
files, and terminals** — a roommate on the Wi-Fi, a coworker on the office LAN, another
container on the Docker bridge. That is the right default for a daemon on a home network
or a single-user machine, and the wrong one for a shared or untrusted network. The
password is the opt-in lock and applies to everyone, LAN included: `fde daemon
set-password` (or `PASEO_PASSWORD`). To keep the pairing gate on the LAN without a
password, run `fde daemon trust-lan off` (the CLI writes `config.json` and applies it live
through the daemon's config reload; `fde daemon status` shows the mode as `LAN Trusted`).

**Claiming** is the first direct pairing. The claim page (or `fde daemon pair` with relay
off) hands out a v3 connection offer: `{ v: 3, serverId, hostname, daemonPublicKeyB64,
direct: { endpoints }, claim: { token, expiresAt }, relay? }` encoded as
`<app.baseUrl>#offer=<base64url>`, which with the default `app.baseUrl` is
`https://frogg.app/pair#offer=…`. The payload lives in the URL fragment, so the page host
never receives it; the same payload is also offered as the app deep link
`paseo://pair#offer=…` (the gate page's "Open in FDE app" button, and `deepLink` in
`fde daemon pair --json`), which the desktop shell routes straight into the app. The token is
single-use and expires after ten minutes.

The app (`apps/ui/src/pairing/`) parses either form with `parseAnyConnectionOfferFromUrl`,
probes each of `direct.endpoints` with `GET /api/identity` and keeps only one whose
`serverId` matches the offer (an endpoint on one of the device's own /24 subnets is tried
first), then `POST /api/setup/claim { token, label }` with a device label such as
`FDE Desktop on <machine>`. The daemon mints a principal with all permissions and one
credential, returns the plaintext credential once, and stores only its SHA-256 in
`principals.json` (mode 0600). The app stores that credential as the `password` of a
`directTcp` host connection, so from then on it is the bearer for that device
(`Authorization: Bearer …`, or the `paseo.bearer.<credential>` WebSocket subprotocol, the
same slot a password uses), and the daemon is claimed. A used or expired token answers 403
and the app asks for a new link; when no endpoint answers it lists the ones it tried and
lets the user type another; an endpoint that answers with a different `serverId` is
reported as a mismatch rather than claimed. Anyone who can reach an unclaimed daemon on the
network can claim it; that is no wider than the pre-gate behavior, where they could already
control it.

Related surfaces:

- `GET /api/identity` (public): `{ product: "fde", serverId, hostname, version, listen, pairingRequired, lanTrusted }` (`pairingRequired` is answered for the requester's own address)
- `GET /api/setup/status` (public): `{ claimed, pairingRequired }`, polled by the claim page
- `POST /api/setup/offer` (bearer policy applies): a fresh direct offer for pairing another device
- `fde daemon claim-status [--json]`, `fde daemon reset-claim [--json]`: inspect or delete `principals.json`
- `fde daemon trust-lan on|off [--json]`: write `daemon.auth.trustLan` and apply it live; `fde daemon set-password`: the opt-in lock for everyone

Per-principal grants are recorded (`permissions` on each principal) but every paired
device currently receives the full owner set; narrowing per device is future work, and the
session model already attenuates rather than widens.

## Permissions

| Permission          | Authority                                                                  |
| ------------------- | -------------------------------------------------------------------------- |
| `daemon.read`       | Daemon status, diagnostics, configuration, and provider information        |
| `daemon.manage`     | Restart, update, configuration changes, providers, skills, and plugins     |
| `tunnel.manage`     | Relay, Hub, service tunnel, and public endpoint relationships              |
| `access.manage`     | Pairing invitations, principals, credentials, grants, and revocation       |
| `workspace.read`    | Projects, workspaces, agents, timelines, files, diffs, and terminal output |
| `workspace.write`   | Prompts, agent control, files, terminals, git operations, and scripts      |
| `workspace.manage`  | Create, rename, archive, and remove projects and workspaces                |
| `automation.manage` | Schedules, heartbeats, and loops                                           |
| `hub.execute`       | The Hub-owned execution lifecycle                                          |

Agents and terminals use workspace authority. Both can execute code and mutate the workspace, so separate write permissions would claim an isolation boundary the daemon cannot enforce.

Owner, operator, and viewer are UI presets expanded into explicit permissions. Do not persist them as roles. Adding a permission must not silently widen an existing principal.

Permissions are additive allows. Missing authority denies the operation. Do not add deny precedence.

## Resources

Permissions are daemon-wide today. Future grants may select workspaces or agents, but operation classification remains inside the authorization module:

```ts
type Grant = {
  permission: Permission;
  resource: { kind: "daemon" } | { kind: "workspace"; ids: string[] };
};
```

A delegating principal can grant only authority it already possesses. A session may attenuate its principal's grants but cannot widen them.

Workspace-scoped grants require every resource-bearing operation and outbound observation to enforce the same workspace boundary. File preview currently accepts any daemon-readable regular file, so it must gain resource enforcement before workspace-specific access ships.

## Hub

The Hub authenticates as a service principal. Its locally selected grants decide whether it may execute agents, manage the daemon, manage tunnels, or manage access.

Hub user and role identifiers remain opaque external subjects. The Hub may create and revoke linked daemon principals when granted `access.manage`; the daemon does not interpret accounts, organizations, or roles.

Hub enrollment and permission updates exchange these semantic permissions directly. Legacy persisted Hub relationships that contain `hub.execution.*` migrate once to `hub.execute` when the daemon loads them; new relationships never persist or emit transport scopes as authority.
