# Outstanding work — current decisions

Updated 2026-09-13 against `origin/main` at `4a3c01ab`.
The original path inventory remains in [the audit summary](audits/local-worktree-summary-2026-09-13.md)
and its linked reports. Historical snapshots are not current task status.

## Merge follow-through — 2026-09-13

User explicitly authorized merging without waiting for CI. Integrated PRs
**#59 attachment checks**, **#60 sidebar drafts**, and **#63 project/conversation
import** into main as version **0.7.0**. Feature code merged cleanly; resolved
version/lockfile metadata and preserved all changelog/roadmap entries. GitHub merge
API failed with HTTP502; integration used Git merge history and a non-force push.

- [x] Integrate #59, #60 and #63 with their full branch histories.
- [x] Preserve the decision document and audit appendices in Git.
- [ ] Run combined-main full typecheck and CI; no new combined-tree validation was
      run before merge under the explicit CI waiver. Prior individual PR evidence is
      not proof of the integrated revision.
- [ ] Resolve remaining Windows/branding checks and verify the combined Nix hash.
- [ ] Build Windows client, Linux daemon and Android from the merged source.
      Publication and installed-update acceptance remain separate work.
- [ ] Verify import interrupted-transfer/corrupt-cleanup recovery and cross-machine
      behavior on actual clients. Uploaded Claude/Codex exports remain text history;
      native resume depends on supported provider sessions available to the daemon.

The existing monitor owns post-merge follow-through:
`98d9fb49-d923-409c-8062-f970c03608ed`, heartbeat `55f33684`.

## Approved and delegated

- [x] **S1 — Reject oversized attachments before reading/copying.** Approved.
      Agent `/root/stop`, branch `fix/attachment-preread-size`, worktree
      `/tmp/fde-attachment-size-current`. Adapt shared browser/Expo and Electron paths;
      meaningful regression checks, full typecheck, PR and merge on success.
- [x] **S2 — Resume unfinished workspace drafts through the sidebar.** Approved.
      Agent `/root/install`, branch `feat/sidebar-draft-resume`, worktree
      `/tmp/fde-sidebar-draft-resume`. Preserve current submission lifecycle and host
      navigation; regression checks, full typecheck, PR and merge on success.
      Coordinate version/integration after S1 to avoid conflicting release bumps.

- [x] **P5 — Import projects with conversations through Add project.** Approved;
      replaces the narrow CLI session-import proposal. Agent `/root/connect` owns
      implementation in a new isolated worktree. Support source directories and
      conversations on this computer or the selected daemon machine, including a
      remote daemon. Merge into an existing matching project and deduplicate sessions.
      Audit actual provider formats and resume capabilities; distinguish importing
      history from transferring code or making a provider session resumable. Client
      paths must not be treated as paths accessible to a remote daemon. Build source
      selection, discovery/preview, transfer where needed, and regression coverage.

## Awaiting owner decisions / explanation

- [ ] **P3 — LAN trust default and live claim-status reporting.** Main and published
      0.6.13 default `trustLan` to true. Unless a password is set, private-network clients
      are trusted without pairing. Proposed old patch makes a network listener default
      to untrusted while preserving explicit choices, and reads live trust state for
      claim status. Separate the useful reporting correction from the pairing-policy
      decision. This is distinct from Q1's listener address.
- [ ] **P2/P4 — Android in-app update prompt and signing migration.** Old prompt
      polls releases and links an APK, but hardcodes arm64 and rejects unsigned assets.
      Current distribution intentionally preserves debug-signed upgrades pending a signing
      migration. Decide prompt scope and migration together; do not copy unchanged.

## Verified complete — removed from outstanding tasks

- **R1:** draft lookup fix merged as `222a357f`; `v0.6.13` is public stable Latest,
  published 2026-09-13T06:23:38Z. The previous publication blocker is resolved.
- **Q1:** configuration/listener work merged through `e7b6589b` (including
  `b9eb2e7f` and `fb2df63c`). Main defaults new config and SSH deployment to
  `0.0.0.0:9999`, provides readable config/config-format, and lets services follow
  saved config unless explicitly overridden. Existing loopback settings remain intact.
  Published0.6.13 predates these changes; “merged” is not “installed on your host.”
- **Q2/P1:** directory browser merged as `4f292540`, included in main. Independent
  subagent verified27 directory-browser/model tests and5 server POSIX explorer tests.
  No duplicate PR needed. Current browser/device acceptance was not rerun.
- **Q3:** cancellable/retryable network discovery merged through `e7b6589b`;
  current hook exposes cancel and uses cancellation across probes. No longer pending.
- **Q4:** selected-build workflow already exists and has evolved in main. Dismiss
  the old integration task; do not remove the maintained workflow.

## Dismissed by owner — do not implement

- **P6/P7:** CLI open-agent and GitHub-clone convenience commands dismissed.

- **S3:** old virtualizer variant/review task; main already has stable callbacks.
- **D1/D2/D3:** persistent diagnostic feature, old profiling tooling, historical trace update.
- **D4/D5:** retired native-window/transport/updater experiments.
- **M1–M8:** old mobile roadmap proposals.
- **P8/P9/P10:** old CLI redesign/empty speech group, Companion removal, and
  CI/performance/config reversions.
- **C1–C3:** no further migration task for transferred patches, generated residue,
  or stashes. Dismissal does not authorize deleting user runtime state or dirty worktrees.
- **R2/R3:** remove from this migration decision list. Release source selection and
  required installation/update checks still apply when a release is requested.

## Verification boundary

“Live” above means the published stable release, not a probe of the user's running
machine. No live daemon/service was changed or inspected. `v0.6.19` was still a draft
at verification time. New approved PRs must report actual checks and merge results;
this document does not mark delegated work complete before that evidence arrives.
