export function portableCommand(
  command: string,
  args: string[],
  options?: {
    platform?: string;
    execPath?: string;
    env?: Record<string, string | undefined>;
    exists?: (path: string) => boolean;
  },
): { command: string; args: string[] };
