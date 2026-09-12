import { createFdeApi, type FdeApi } from "@fde/client";
import type { DaemonClient } from "@fde/client/internal/daemon-client";

export interface PluginSurfaceRuntime {
  fde: FdeApi;
  invoke(method: string, input: unknown): Promise<unknown>;
}

export function createPluginSurfaceRuntime(
  client: DaemonClient | null,
  pluginId: string,
): PluginSurfaceRuntime | null {
  if (!client) return null;
  return {
    fde: createFdeApi(client),
    invoke: (method, input) => client.invokePluginRpc(pluginId, method, input),
  };
}
