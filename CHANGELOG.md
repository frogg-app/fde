# Changelog

## 0.1.3

- Rebrand to FDE (Frogg Development Environment): `@fde/*` package scope, new origami frog logo and icons, `fde` binary and CLI alias. Wire-level Paseo names kept for compatibility.
- Portable Windows zip published alongside the installer.
- ROADMAP.md added.

- Rebranded the product to FDE (Frogg Development Environment): npm scope `@fde/*`, desktop productName/window title "FDE", bundle identifier `app.frogg.fde`, binary `fde`, new logo, `fde` CLI alias. Wire-level names (`paseo://`, `PASEO_*`, `~/.paseo`, the `paseo` CLI) are unchanged for daemon compatibility.
- Fork from Paseo v0.7.2 (commit 77aff0f). New repository, Tauri desktop shell rewrite begins.
- Repo reorganised into apps/ and packages/; Electron shell and website dropped.
- New Tauri v2 desktop shell (apps/desktop): window, bridge, settings, attachments, dialogs, notifications, deep links. Remote hosts only; no local daemon yet.
