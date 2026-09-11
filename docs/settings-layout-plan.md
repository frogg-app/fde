# Settings layout plan

Proposed 2026-09-11. This is a design and implementation plan, not shipped behavior.
The sidebar navigation cleanup is a separate implementation in the same work batch.

## Goal

Make the scope of every setting clear before the user changes it. Opening Settings
starts in **App settings → General**. Two labeled tabs at the top switch between
**App settings** and **Host settings**. App settings configure this installation;
Host settings configure the selected daemon and can affect other connected clients.

Keep the existing wide modal and compact full-screen presentations. Use the same
navigation model and labels in both, with a category list and detail view on compact
screens. Keep the desktop detail column readable at its existing 720px maximum.

## What the current implementation mixes

- `screens/settings/settings-sidebar.tsx` places app categories and a host picker
  with host categories in one long navigation list.
- `screens/settings/host-page.tsx` combines local appearance, daemon supervision,
  remote deployment, self-update, and removing a saved host on one page.
- `screens/settings/host-appearance-section.tsx` uses `useHostMutations` for names,
  colors, and badge preferences. These persist in the client host registry through
  `runtime/host-runtime.ts`; they are not daemon identity changes.
- Connections are saved client connection choices. Providers, metadata generation,
  agent/workspace defaults, and other daemon configuration use host-scoped APIs.
- General already contains local voice playback and Companion UI preferences;
  these remain local even though the associated service runs on a daemon.

Source paths in this document are relative to `apps/ui/src/` unless stated otherwise.

## Proposed navigation

```text
Settings                              [App settings] [Host settings]   Close

App settings                          Host settings
  General                               Host: [name · connection status ▾]
  Appearance                            Overview
  Editor                                Providers
  Keyboard shortcuts                    Agents
  Notifications & voice                 Workspaces
  Integrations                          Projects
  Hosts                                 Terminals
  Permissions                           Plugins
  Diagnostics                           Metadata generation
  About                                 Usage
                                        Access & pairing
                                        Maintenance
```

Only show platform-supported app categories, preserving current capability gates.
Fold the existing Layout category into Appearance rather than adding another top-level
choice. Keep permissions on the app side limited to this device's OS permissions.
Daemon authorization belongs in Access & pairing.

Host selection appears only inside Host settings. It shows the selected host name
and a text connection state, with connection details available to distinguish similar
names. It remains visible while navigating host categories. Changing it preserves
the category when supported and never changes the active workspace or another tab's
host selection. A direct host-settings link selects its explicitly named host.

## App settings → Hosts

A list of saved hosts with a labeled **Add host** button. Each row shows the local
name, address/connection summary, and text status. Selecting a row opens its local
profile; it does not jump into daemon configuration.

The profile contains:

- **Display:** name in this app, color, and badge visibility.
- **Connections:** saved direct, relay/pairing, and SSH connection details;
  add/edit/remove using the existing supported flows. Any edit flow missing today
  is an explicit implementation task, not assumed to exist.
- **Local daemon:** on desktop, whether this app enables and supervises its local
  daemon. This is an app-owned lifecycle policy, not remote daemon configuration.
- **Host settings:** one labeled action opening the other tab with this host selected.
- **Remove from this app:** remove the saved profile and its local credentials using
  the existing cleanup path. Confirmation explains that this does not uninstall the
  daemon or delete projects. Preserve platform-specific local-daemon constraints.

Saved names and connection preferences remain editable while the host is offline.
Connection validation reports failure without discarding entered values. Adding a
host returns to its local profile with a connection result and the Host settings
shortcut. Pairing a new connection remains part of Add host; authorizing another
client from an existing daemon belongs under Host settings → Access & pairing.

SSH bootstrap/install is a separate **Set up daemon over SSH** action in the profile's
connection setup flow: it uses a local connection to provision a remote deployment,
not the daemon settings API. Clearly name the destination and report installation
progress. Do not place local SSH credentials in daemon configuration.

## Host settings

Show a short scope label: “Settings for <host>. Changes affect this daemon.” Load
values from that host's API and save through existing authorized daemon operations.
Use the runtime's actual capability/permission results to decide available actions.

| Area                  | Content and ownership                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Overview              | Daemon identity, version, platform, and current connection status; read-only facts.                  |
| Providers             | Installed/configured providers and their daemon-owned configuration.                                 |
| Agents                | Shared agent profiles, skills, and daemon defaults.                                                  |
| Workspaces / Projects | Existing daemon workspace defaults and per-project settings; retain project identity and navigation. |
| Terminals             | Daemon terminal profiles/defaults; local renderer and scrollback preferences stay in App settings.   |
| Plugins               | Daemon plugin configuration; local desktop integrations remain in App settings.                      |
| Metadata generation   | The daemon's selected generation provider/model.                                                     |
| Usage                 | Host/provider usage facts; label freshness and refresh failures.                                     |
| Access & pairing      | Existing daemon pairing and authorization controls; client OS permissions stay in App settings.      |
| Maintenance           | Supported daemon restart and self-update, with the selected destination visible.                     |

Do not add controls for configuration that has no supported read/write API. Inventory
any requested missing APIs separately with daemon ownership, validation, authorization,
and restart semantics before exposing editable fields. Preserve unsupported/deferred
features as roadmap work rather than creating switches that cannot take effect.

For a desktop-managed daemon, package download/version selection and supervision stay
with App → Hosts → Local daemon when performed by the desktop shell. A daemon-reported
self-update operation belongs in Host → Maintenance. Avoid duplicate update buttons:
select the supported owner/action and explain which installed daemon it affects.

## State and interaction rules

- No saved hosts: Host settings shows “Add a host to configure its daemon” and a
  labeled action opening App → Hosts → Add host. App settings remain usable.
- No explicit host selection: prefer the current workspace's known host, then the
  last settings host if still saved, then the sole saved host. With multiple hosts
  and no valid candidate, show “Select a host”; do not silently pick a destination.
- Offline host: show offline status, last-known values marked stale if available,
  and Retry. Disable daemon writes; local profile editing stays available.
- Loading, unsupported capability, denied access, and failed requests are distinct
  states. Missing runtime data must not be rendered as an empty/default config.
- Save feedback is rendered next to the control or form: pending, confirmed success,
  and an actionable error. Preserve failed drafts. Do not rely on native alerts
  that fail to render in web clients.
- Bind reads, drafts, pending writes, and errors to the host ID. Switching hosts
  cannot apply a late response or draft from the previous host to the new host.
- Protect unsaved forms on host/category switches with the existing confirmation
  pattern. Completed saves refresh confirmed values; restart-required changes say so.
- Mount only the active settings detail. Clean up page-specific subscriptions,
  timers, and requests on close/switch; do not introduce polling across every host.
- Tabs, category rows, host selector, and bottom sidebar actions have visible labels,
  keyboard focus, selected state, and usable touch targets. Reuse existing primitives.

## Implementation slices and ownership

1. **Client: explicit navigation scope.** Extend `navigation/settings-navigation.ts`,
   `utils/host-routes.ts`, and `settings-modal/store.ts` to represent App and Host
   destinations, including a local host profile. Add the two tabs in the shared
   settings presentation and default fresh Settings entry to App → General.
2. **Client: saved Hosts page.** Extract local appearance/connections/removal and
   desktop supervision from `host-page.tsx`. Reuse the current add-host dialogs and
   host registry. Route add-host entry points here, including Home and deep links.
3. **Client + desktop: daemon categories.** Move operational maintenance to the
   selected-host view; separate desktop/SSH provisioning actions by actual owner.
   Reuse existing pages rather than rewriting their forms during navigation work.
4. **Daemon, only for identified gaps.** Assign one owner for any needed shared
   schema/API change and agree behavior before client work depends on it.
5. **Client: migration and acceptance.** Preserve existing settings links: old
   Connections routes map to App → Hosts → profile; host configuration and project
   routes map to Host settings with explicit IDs. Map the old mixed Host overview
   to Host → Overview with a visible Edit local profile link. Preserve add-host
   intents and close/back behavior across modal and compact routes.

## Acceptance

- A fresh Settings open shows App settings without requiring a daemon connection.
- Two saved hosts can be edited locally offline; neither edit changes daemon config.
- A daemon setting saved for host A changes A, not B; switching mid-request cannot
  display A's response as B's saved state. Verify against isolated daemons.
- Adding/removing a saved host updates the picker and leaves valid navigation;
  removal does not delete remote projects or stop an independent daemon.
- Deep links, add-host intents, project detail/back, modal close, keyboard navigation,
  and compact layouts still work. Test zero, one, multiple, and disconnected hosts.
- Every moved fallible action has user-visible success/failure coverage. Run focused
  navigation/component tests and real browser/device acceptance where available;
  report device gaps separately from passing automated checks.
- Repeated settings open/close and host switching leave page-specific listeners and
  polling bounded. Include these cycles in the memory/lockup regression workload.
