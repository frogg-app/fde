/** Retain the live owner across module reloads, which change constructor identity.
 * The private registry key must keep the same runtime contract across reloads.
 */
export function getSharedRuntime<T extends object>(
  registry: object,
  key: string,
  create: () => T,
): T {
  const existing = Reflect.get(registry, key) as T | undefined;
  if (existing) return existing;
  const runtime = create();
  Reflect.set(registry, key, runtime);
  return runtime;
}
