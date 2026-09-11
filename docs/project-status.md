# Repository baseline audit

Audit date: 2026-09-11. The planning source is [ROADMAP.md](../ROADMAP.md).
This is a record of reconciliation, not a claim that old worktrees are active.

## Baseline integration

Started from `origin/main` at `7e60824` (the local checkout was 13 commits behind).
Integrated these outstanding patches into the 0.2.1 maintenance baseline:

| Source                                           | Disposition                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `release/0.2.0`: `4130e6d`, `dd2f975`, `7507126` | Companion interruption, interrupted history, earlier first speech segment and reply orb level                     |
| `investigate-fixability`: `cf2e26e`              | Cold local speech worker grace and spoken-alert retry; added concurrent-read deduplication coverage during review |
| `worktree-memleak-and-installer-icon`: `7b1d3f6` | NSIS icons, opt-in release inspector and idle memory diagnostic                                                   |

These patches are consolidated rather than importing old branch history. The
imported voice research note was replaced with implementation facts and explicit
remaining gaps; unverified third-party product claims are not project requirements.

## Already integrated or superseded

- `workspace-voice-alerts-optin`, `pairing-service-and-installer-fix`, and the
  sidebar/performance release work are already in main.
- The directory-cache and config-write branches have equivalent squash-merged
  patches in main. The Android OOM fix is also integrated.
- `voice-conversation-orchestrator` was squash-merged as PR #29. Its old commit
  identities do not indicate 32 missing features.
- `fix/test-home-isolation` corresponds to the isolation work merged as PR #10;
  subsequent main changes supersede its older CI and dependency state.
- `mobile/tts-notification-playback` and `protocol-hygiene` retain historical
  notification/validator changes. Main has the newer notification presentation,
  workspace opt-in behavior, ignored `.dev/` state and regenerated validators.
  Do not replay these branches wholesale: removing the tracked validator and
  restoring old notification behavior would undo current choices.

Keep historical branches while another worktree references them. Patch identity
alone cannot determine whether a squash-merged branch still needs integration.

## Preserved unfinished work outside this checkout

The shared Git repository also has older worktrees with substantial staged and
unstaged changes. They were inspected by path/status only where runtime state
could be sensitive. Their working files and indexes were not changed by cleanup.

- `/home/frogg/projects/ade`: installer/claim/CLI changes, add-project and mobile
  navigation changes, Android update work and local runtime state. Its base is
  older than current main; some edits overlap already integrated work.
- `/home/frogg/projects/ade-fix`: CLI additions and a broad removal of Companion,
  alongside CI/protocol changes. Removing a released feature is a separate product
  decision; these changes are not part of the maintained FDE baseline.

No runtime state, credentials or unrelated worktree changes were committed.
Do not reset, delete, or bulk-stage these worktrees. If the work is resumed,
extract a coherent diff against current main and validate it independently.
In particular, `ade-fix` also reports branch `main`; avoid moving that shared
local branch while its unfinished index remains attached to it.

## Dependency PRs

Seven Dependabot PRs were open at audit time: #12, #13, #15, #16, #17, #18 and
#35. They remain separate from baseline integration. #13 and #18 had green PR
checks, but those checks do not constitute desktop platform acceptance for #13.
The others had failing checks; #35 failed during dependency setup. Review version
compatibility and rerun current checks before merging, rather than bundling them
with recovered application fixes.

## Verification boundary

The baseline uses a server build, full workspace typecheck, format/lint checks,
focused Companion/voice regression suites and desktop bridge/Rust tests.
Device voice acceptance, Windows/macOS installers and updater hand-off remain
roadmap items. The idle memory probe is opt-in diagnostic tooling and does not
establish a measured memory or streaming performance improvement.
