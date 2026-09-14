/**
 * Creation times as sent on workspace/project descriptors. Values come straight from the
 * registry records (`createdAt` is required there; records bootstrapped from pre-registry
 * state carry the earliest agent timestamp). Unparseable values are omitted so clients treat
 * the item as having no known creation time.
 */
function validIso(value: string | null | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function createdAtFields(
  workspaceCreatedAt: string | null | undefined,
  projectCreatedAt: string | null | undefined,
): { createdAt?: string; projectCreatedAt?: string } {
  const createdAt = validIso(workspaceCreatedAt);
  return {
    ...(createdAt ? { createdAt } : {}),
    ...projectCreatedAtField(projectCreatedAt),
  };
}

export function projectCreatedAtField(value: string | null | undefined): {
  projectCreatedAt?: string;
} {
  const projectCreatedAt = validIso(value);
  return projectCreatedAt ? { projectCreatedAt } : {};
}
