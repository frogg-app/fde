# Add Project directory browsing

Choosing **Search for directory** starts at the selected daemon user's home (`~`) every
time the page is opened. The browser lists immediate subdirectories, sorted by name;
typing a name filters that list locally. It does not recursively search the host.

**Use this directory** adds the directory currently being viewed as a project.
**Go to parent** navigates one level up and is absent at a filesystem root. Both
actions stay above the scrolling child list, separated by a divider. Selecting a
child navigates into it; it does not add that child as a project.

Typing `~`, an absolute path, or a relative path containing a separator presents
**Navigate to …**. Enter selects that destination, loads its immediate children,
and clears the filter. `.` and `..` are also supported. Path expansion and directory
validation happen on the daemon, so `~` refers to the daemon's home, not the client's.
Windows drive paths and UNC share roots are supported by the client path helpers.

During a listing request, choosing the directory is disabled and cached child rows
cannot be selected. Failed requests keep the error visible and provide **Retry**;
parent navigation and entering another path remain available. The dialog Back action
returns to the project-source choices.

Directory listings include an optional `absolutePath` on the existing file-explorer
response. New daemons return the expanded requested path, allowing the client to
identify the parent of `~` and suppress parent navigation at filesystem roots.
Earlier 0.6 daemons remain parseable and use the requested path; upgrading the daemon
is needed to resolve the parent of a home-relative path. Existing workspace symlink
boundaries are preserved. In-scope symlinks to directories are listed as directories.

Behavioral coverage lives in the directory-browser model tests, file-explorer service
tests, and `apps/ui/e2e/browser/add-project-flow.spec.ts`. Windows/Android visual and
device validation must be recorded separately from these automated checks.

The existing Add Project component remains above the file-length guideline because
it coordinates the complete multistep flow and shared modal rendering. This change
extracts directory navigation policy into `add-project-flow/directory-browser.ts`;
splitting the remaining GitHub and creation flows is outside this fix.
