# Desktop shell

FDE 0.6 uses the Electron application in `apps/desktop-electron`. It loads the
shared Expo web export and exposes native capabilities through
`window.fdeDesktop`. The renderer is sandboxed and context isolated; it receives
validated IPC operations rather than unrestricted Node access.

The application is app-only. It includes Electron and the renderer, with no
bundled daemon, separate Node executable, CLI, or provider binaries. Install the
Node daemon independently on a local machine or remote host and connect through
direct WebSocket, relay, SSH, Unix socket, or Windows named pipe transport.
Closing, relaunching, or updating the desktop app leaves those daemons running.

The shell owns windows, native dialogs and notifications, desktop settings,
attachment handling, deep links, SSH transport and remote daemon deployment,
and application updates. The shared UI owns interaction and connection policy;
`packages/client` and `packages/protocol` own the client/server contract.

The app protocol is `fde://app`; operating-system links use `fde://`.
The 0.6 namespace migration requires a coordinated upgrade of clients and daemons.
See [upgrade notes](upgrade-0.6.md) before changing an existing installation.

See [desktop development and acceptance](electron-desktop.md),
[building](building.md), and [testing](testing.md). Desktop window/process
behavior, signing, and installed updates require platform evidence in addition
to builds and unit tests.
