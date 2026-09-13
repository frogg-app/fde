# Project and conversation import

Status: implementation in progress on `feat/project-conversation-import`.

Add Project gains an Import project entry. Source and destination are explicit:

- On the selected daemon: discover existing provider sessions for a project directory, preview matching sessions and existing project, then import selected sessions with provider-native resumability.
- This computer: explicitly select a project directory and conversation files, transfer bounded files to a new daemon directory, or merge conversation history into an existing daemon project without overwriting its code.

Provider-native discovery follows installed provider capabilities. Uploaded Claude/Codex JSONL histories are transcripts, not portable provider credentials or guaranteed resumable sessions. The UI must label this distinction before import and when viewing imported transcripts. Unsupported formats produce a visible error; never claim universal JSON compatibility.

Preview performs no project/session mutation. Commit revalidates identity and deduplicates native sessions by provider+native handle, imported transcripts by stable source identity/content. Existing project identity follows canonical daemon path, never display name alone. The daemon owns final validation and persistent dedup so retries/disconnects cannot duplicate history. Code transfer creates a fresh directory and never overwrites existing project files; transcript merge does not alter existing code. Uploaded paths must be relative, portable, traversal-free and collision-free. Bounds apply to files, entries, individual and total bytes; exclude symlinks and provider credentials. Cancellation and partial results remain visible and retryable.

Web/Electron file selection cannot be treated as a daemon path. Mobile/browser capabilities are checked explicitly and unsupported local directory selection directs users to daemon source instead. Directory names are source data, never shell arguments. No commands are executed from imported content.

Verification: parser/identity and transfer-boundary tests; real filesystem project merge/dedup tests; protocol permissions/compatibility; client state success/failure tests and focused Add Project browser flow; translations in all nine locales; full typecheck and CI before merge. No live daemon/user-data mutations during development.

## Implemented contract

The new `projectImport` daemon capability gates the Add Project entry once. The
flow explicitly asks whether conversations live on this computer or the selected
daemon. Client filesystem paths are never interpreted as remote filesystem paths.
A user specifies the destination directory on the daemon; its canonical identity
selects the existing Frogg project or creates one during commit. Preview and file
staging do not create projects or sessions.

Daemon-source import can also read exported JSONL from an explicitly selected
daemon directory. Native discovery/import is reused from installed providers, filtered
to the canonical project directory. Existing native session owners are reused.
Client-source import accepts explicitly selected Claude and Codex JSONL text
histories and optional project files, transferred in bounded chunks. History is
stored separately from runnable agents and is clearly labeled before import.
Tool calls, tool output, images and attachments are not portable transcript data
in this implementation. Arbitrary JSON formats are rejected. Local file selection
is available in Electron/web; mobile can import from its daemon.

Uploaded project files may only create a new destination; conversation-only uploads
may merge into an existing project. Imports never overwrite existing source files.
Git internals, dependencies and common credential filenames are excluded. Copied
files are regular files; executable permissions and Git repository metadata are
not transferred. Directory
traversal, absolute/Windows-device paths, malformed chunks, case collisions and
incomplete uploads are rejected. Limits: 2,000 files, 16 MiB per file, 64 MiB total,
500 conversations and 128 KiB per displayed message. Transfer is cancellable;
commit completes on the daemon if the client disconnects.

Committed text history persists under `FROGG_HOME/project-conversations`, keyed by
project identity and provider session identity when available, or normalized content
otherwise. Reimporting equivalent or older text skips it, including after daemon
restart. A longer matching history updates the same conversation; divergent
versions report a conflict without overwriting either source file. Restarting the daemon before commit
requires a fresh preview/upload. Imported history can be reopened through Add
Project → Import → preview the existing daemon directory; it is not represented as
a resumable coding agent. Staged imports expire after one hour; periodic cleanup also discovers interrupted
uploads after daemon restart. Project file copies are fully staged before publishing
the destination, so a failed copy leaves the target absent and retryable.

## Validation

Focused parser, real-filesystem transfer/merge/deduplication, native project filtering,
RPC correlation/authorization, upload cancellation, dialog success/failure and
nine-locale parity checks cover the contract. Independent review drove additional
regressions for cancelled queued commits, partial-copy recovery, replaced directory
identities, expired/corrupt staging manifests, and exported daemon conversations. Full repository typecheck and CI are
required before integration. Native Windows/macOS file-pickers and real-provider
resumption are separate platform acceptance checks; this headless VM does not
establish those results.
