/** Ownership is process-local: another shell or CLI may share the daemon home. */
export class DaemonOwnership {
  private pid: number | null = null;

  recordStarted(
    spawnedPid: number | undefined,
    status: { pid: number | null; desktopManaged: boolean },
  ): void {
    if (spawnedPid && status.desktopManaged && status.pid === spawnedPid) this.pid = spawnedPid;
  }

  owns(status: { pid?: unknown; desktopManaged?: unknown }): boolean {
    return this.pid !== null && status.desktopManaged === true && status.pid === this.pid;
  }

  assertManualControl(status: { pid?: unknown; desktopManaged?: unknown }): void {
    if (!this.owns(status))
      throw new Error(
        "This daemon was started outside this Electron session. Stop it using its owning app or CLI, then start it here to manage it.",
      );
  }

  release(): void {
    this.pid = null;
  }
}
