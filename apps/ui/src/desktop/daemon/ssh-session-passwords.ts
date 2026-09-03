// SSH passwords the user typed for Remote SSH hosts, kept in memory for the
// life of the app process only. Nothing here is persisted: the host
// registry never sees an ssh password, and a restart forgets them all. The
// desktop transport factory reads this store when it opens a session, so a
// remembered password also covers reconnects and deploy jobs.

export interface SshPasswordKey {
  host: string;
  sshPort?: number;
}

const passwords = new Map<string, string>();

function keyOf(key: SshPasswordKey): string {
  return `${key.host.trim()}|${key.sshPort ?? ""}`;
}

export function rememberSessionSshPassword(key: SshPasswordKey, password: string): void {
  if (!password) {
    forgetSessionSshPassword(key);
    return;
  }
  passwords.set(keyOf(key), password);
}

export function getSessionSshPassword(key: SshPasswordKey): string | undefined {
  return passwords.get(keyOf(key));
}

export function forgetSessionSshPassword(key: SshPasswordKey): void {
  passwords.delete(keyOf(key));
}

/** Test helper. */
export function clearSessionSshPasswords(): void {
  passwords.clear();
}
