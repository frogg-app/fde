---
name: fde-build-monitor
description: Monitor FDE CI after pushes in a background agent, diagnose and fix build failures, retry individual targets, and coordinate isolated local and hosted builds to reduce waiting. Use when pushing updates that need build supervision or managing CI/build queues.
---

# FDE build monitor

Keep development moving while one dedicated agent owns build follow-through. A skill
is instructions, not a running service: create or resume the monitor and confirm its
heartbeat before claiming that future pushes are watched. Use the `fde` skill for
agent/workspace/heartbeat operations and `fde-release` for artifact and update rules.

## Start or resume independently

- Reuse the repository's existing monitor agent and heartbeat. Record their IDs and
  workspace in the monitor's durable ledger; do not spawn another monitor per push.
- Give it its own worktree from current `origin/main`. Never build or fix in the
  developer's active checkout. Use configured agent profiles and their notes; if
  none fit, discover available providers and use a supported default.
- Pass repository, branch, requested targets, known runs, source SHA, allowed fixes
  and integration scope. Preserve existing user authorization. Current FDE targets
  are Windows x64 Electron client, Linux x64 Node daemon, Android arm64 client.
- In the monitor agent, create one five-minute heartbeat using the available FDE
  heartbeat tool or `fde agent heartbeat create --help`. Each tick checks new runs,
  advances existing repairs/builds, records results, then yields. Do not sit in an
  endless shell polling loop. Stop/delete the heartbeat when monitoring is cancelled.
- Store a small ledger in the monitor workspace's `.dev/build-monitor/`: repository,
  branch, monitor/heartbeat IDs, source SHAs, workflow/run/job IDs, attempts and
  failure signatures, owned builder worktrees/processes, artifact paths/checksums,
  start/end times and blocked reasons. Atomically update it. Treat unknown state as
  unknown; an old successful artifact does not validate a new commit.
- Report transitions and actionable blockers through the agent's finish notification
  or its FDE thread, not repeated "still running" messages. A coordinator may yield
  as soon as the monitor and recurring check are confirmed active.

## Inspect without restarting work

Run `gh run list --repo OWNER/REPO --branch BRANCH --limit 20 --json
 databaseId,headSha,workflowName,status,conclusion` and inspect jobs with
`gh run view RUN_ID --repo OWNER/REPO --json jobs`. Compare against the ledger.
Read newer pushes on every tick; do not assume a previously observed head is current.

A completed job's logs can be fetched while sibling jobs still run:

```bash
gh api repos/OWNER/REPO/actions/jobs/JOB_ID/logs > job.log
```

`gh run view --log` can refuse until the whole run completes. Use the job API above.
Download logs into the monitor workspace; summarize the failing step and root cause.
Do not cancel healthy siblings to obtain logs or retry one platform.

## Repair and retry the minimum

- Transient runner/network failure, unchanged source: rerun only that job with
  `gh run rerun RUN_ID --repo OWNER/REPO --job JOB_ID`. If GitHub requires the run to
  finish first, record a pending retry; do not cancel healthy sibling builds.
- Deterministic failure: reproduce the smallest failing test/build step locally
  where meaningful, inspect the intended behavior, fix the cause, and run focused
  checks. Never suppress a check just to obtain a green run.
- A rerun always uses the old source SHA. Source fixes need a new revision. The
  selected workflow supports `target=windows`, `daemon`, `android`, or `all`:

```bash
gh workflow run build-selected.yml --repo OWNER/REPO --ref FIX_BRANCH -f target=windows
```

- Use a dedicated repair branch and the project's normal integration checks. With
  existing permission to push fixes to main, fetch again, integrate without force,
  and push only the bounded repair. Otherwise prepare the branch/PR for review.
  Shared protocol, version, branding, and lockfile changes need coordinated checks;
  do not claim unchanged targets were tested at the new revision.
- For a locally checked targeted repair, `[skip ci]` avoids automatically launching
  the whole main pipeline; explicitly dispatch the affected target after pushing.
  Do not use it to bypass required branch protection or broad change validation.
  Ordinary pushes still use normal CI. No need to rebuild successful unrelated
  targets merely to diagnose one failure.
- Confirm the dispatched SHA and enabled jobs before recording a retry. Observe it
  through completion; a queued run is not success. Keep successful sibling artifacts.
- Allow one blind retry for a transient failure signature. If it repeats, diagnose.
  After two unsuccessful source-fix attempts for the same cause, pause that repair
  and report evidence and the next required decision; keep unrelated targets moving.
- Never publish a release, overwrite immutable artifacts, move tags, change signing
  keys, weaken permissions/tests, or alter live daemons as a side effect of monitoring.
  Existing explicit publication authorization is handled through `fde-release`.

## Place builds by capacity and expected completion

Compare observed queue time plus build time against local setup plus build time.
Measure rather than assuming this VM is faster. Inspect CPU/load, available memory,
free disk, toolchain/cache availability, and builds already owned by the monitor.
Reserve capacity for interactive development and other users. Do not kill others'
processes or copy live state to make room.

Prefer Windows hosted runners for native Electron packaging; local Linux daemon
builds are useful with warm dependencies. Android may use a local Linux builder
only when the SDK/JDK, disk and memory are already adequate and the estimate beats
CI. A Linux desktop build does not validate Windows. Do not use the historical
`build:local` Tauri helper for production Electron artifacts.

Build independent targets concurrently on different builders. On one shared VM,
start with one heavy build; add concurrency only when observed memory/CPU/disk
headroom supports it. Each concurrent target gets its own worktree at the same
source SHA, dependency tree, output directories, ports and dev state. Never run
Android, web export, Electron or daemon packaging concurrently in one checkout:
they overwrite shared generated output. Record ownership before launching work.

Use current wrappers, consulting their help and `docs/building.md` first:

- Windows: `npm run build:desktop -- --target win-x64` on a capable Windows builder.
- Linux daemon: `npm run build:server`, `npm run build:daemon-web-ui`, then
  `npm run build:daemon-bundle -- --target linux-x64 --out-dir dist/bundles`.
- Android: `node scripts/release/build-android-apk.mjs --abi arm64-v8a --serial
--out-dir release-assets` produces the bundled test client. Preserve actual
  signing status; a debug variant without bundled JS is not a standalone client.

Keep supervised local builds running between heartbeat turns; record their process
or terminal IDs and log locations. On restart verify ownership and liveness before
resuming; never blindly start duplicate builds. If using a local build to replace a
queued CI artifact, only cancel the exact duplicate job when supported and safe;
GitHub run cancellation cancels siblings too. Otherwise let them finish and avoid
future duplicate dispatches. Local artifacts supplement rather than impersonate
required GitHub checks.

## Completion evidence

For each target record SHA, version, builder, actual artifact and checksum, signing
status, check results, elapsed time and remaining device/update validation. Keep
mixed revisions visible. An artifact build is not installed-client acceptance.
On a quiet tick, retain the heartbeat for future pushes and yield without rebuilding.
