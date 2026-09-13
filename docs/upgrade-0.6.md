# Upgrading to FDE 0.6

FDE 0.6 makes Electron the production desktop app and standardizes the product's
environment, wire, storage, deep-link and plugin names. This requires a coordinated
client/server upgrade. It is not a transparent compatibility release.

## Before upgrading

Record your daemon installation method and state directory, back up that state,
and retain the previous installers and configuration. Record saved host addresses
and pairing requirements before replacing desktop/browser profiles. Avoid mixing
0.6 clients with older daemons during the transition.

The production app uses product name **FDE** and application ID `app.frogg.fde`.
The tested **FDE Electron** profile directory and native preferences are retained
for 0.4.x Electron builds. Renamed browser storage keys and browser-pane partitions
do not import old host selections or cookies; record connections and sign in again. Users of the retired native shell must manually install 0.6 and add/pair
hosts; this is not an automatic installer or browser-profile conversion.

No official relay endpoint is configured by default. Existing paired hosts that
relied on an old hosted relay need a real operator-configured relay or a direct/SSH
connection. Do not substitute an invented hosted endpoint.

If an existing `config.json` has `daemon.relay.enabled: true` without an endpoint,
startup fails with a configuration error. For direct or SSH access, set
`daemon.relay.enabled` to `false` in `$FDE_HOME/config.json` (normally
`~/.fde/config.json`) and rerun the installer. To retain relay access, configure
`daemon.relay.endpoint` with your operator-provided endpoint instead. Installation
does not silently overwrite an explicit relay setting. `fde stop` does not require
a valid startup configuration. `fde status` reports the process state alongside
the configuration error and uses unknown values for settings it cannot resolve.
For a temporary direct launch, `fde start --no-relay` overrides the saved relay
setting for that process; update the configuration before using the login service.

## Namespace changes

- Environment configuration uses `FDE_*`; the daemon state root is `FDE_HOME`.
- Desktop links use `fde://` and the renderer bridge is `window.fdeDesktop`.
- Client symbols use `FDE` names, including the client/API interfaces.
- Wire, storage, plugin, skill and command references use the `fde` namespace.
- Packages remain under `@fde`; the default daemon port remains **9999**.

Update service definitions, environment files, launch scripts, bookmarks, client
integrations, plugins and skill references together. Do not assume legacy aliases,
saved browser keys, or old wire identifiers are still accepted. Re-pair hosts when
required rather than copying an incompatible browser profile.

## Application and daemon lifecycle

Install the desktop app and Node daemon independently. Electron includes no local
server or CLI and never owns a local daemon. A separately installed local daemon
is still a valid connection target; SSH deployment remains available for remote
hosts. Quitting the app does not stop agents on the daemon.

The 0.5 independent execution service remains opt-in through
`FDE_EXECUTION_SERVICE=1`. Normal gateway restart preserves retained execution;
explicit stop-all ends it. Its real-provider background work, Windows/macOS
lifecycle and complete installed-update acceptance remain unverified. See the
[independent execution specification](plans/independent-execution-service.md).

## Verify and recover

Network discovery identifies known pre-0.6 daemon versions and shows an update
instruction instead of attempting an incompatible connection. If discovery still
reports the old version after installation, the old daemon is still serving that
address; verify the running service and restart it before scanning again. Unknown
versions remain connectable because discovery alone cannot establish compatibility.
After a failed manual direct connection, the app also checks the identity endpoint
for a known pre-0.6 version and presents the same upgrade guidance. If that probe
fails or reports a current version, the original connection error is retained.

The repaired installer stops the daemon recorded in the selected state directory
before activating the installed version. It then checks `/api/identity` and
`/api/health`; a stale version or startup failure exits with an error instead of
reporting a successful installation. `FDE_NO_SERVICE=1` installs files only and
does not perform activation checks. Set `FDE_HEALTH_TIMEOUT` to adjust the default
30-second activation deadline. The installer prints the host’s non-loopback
interface addresses for wildcard listeners, preserving the configured port.
On hosts with multiple interfaces, it prints each available URL. Explicit
listener addresses are printed directly; Unix sockets need a proxy or TCP
listener for browser access.

For script installations, use `fde update` or the host settings **Daemon updates**
section. Older update requests also use the versioned release updater instead of
requiring a global npm installation. The CLI hands off restart and rollback to
its update supervisor.

After both sides are upgraded, verify pairing, reconnect, plugins, permissions,
terminal access and agent resume on an isolated workload. Verify installed desktop
updates separately from standalone launch. If reverting, restore a matching
client/daemon version set and its backed-up configuration; do not assume newer
state or protocol identifiers can be consumed by older builds.
