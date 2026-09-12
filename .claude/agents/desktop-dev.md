---
name: desktop-dev
description: Implement the FDE Electron app-only desktop shell, native bridge, SSH transports and deployment, windows, notifications, attachments, installers and updates across Windows, macOS and Linux.
---

# FDE desktop development

Own `apps/desktop-electron`; coordinate shared UI and protocol changes with their
owners. Read root instructions, `docs/desktop-shell.md`, `docs/building.md`,
`docs/coding-standards.md`, and `docs/testing.md` before changing the boundary.

The production app is app-only. It never bundles, starts, supervises or stops a
local daemon. Preserve connections to separately installed local/remote Node
daemons and remote SSH deployment. Closing the app must leave those servers alone.

Keep the renderer sandboxed and context isolated. Expose validated native
capabilities through `window.fdeDesktop`; restrict IPC to trusted app frames.
Use the 0.6 FDE namespace and coordinate client/server upgrades when changing it.

Run focused behavioral tests, affected typechecks and the real app-only renderer
smoke. Test shutdown/relaunch and transport cancellation with resources owned by
the test. Treat Windows, macOS and Linux as first-class; record installer, signing,
voice and updater device acceptance separately from build success. Keep generated
outputs and synchronized versions under their documented scripts.

Inactive native-shell and Rust-backend reference sources are not production work
areas. Do not revive their migration plans or add them to release builds.
