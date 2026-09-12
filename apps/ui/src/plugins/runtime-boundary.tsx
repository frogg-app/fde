import { QueryClientProvider } from "@tanstack/react-query";
import { FdeApiProvider, PluginRpcProvider } from "@fde/plugin/host";
import type { ReactNode } from "react";
import type { InstalledPlugin } from "./types";
import type { PluginSurfaceRuntime } from "./surface-runtime";

export function PluginRuntimeBoundary({
  plugin,
  runtime,
  children,
}: {
  plugin: InstalledPlugin;
  runtime: PluginSurfaceRuntime;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={plugin.queryClient}>
      <FdeApiProvider fde={runtime.fde}>
        <PluginRpcProvider invoke={runtime.invoke}>{children}</PluginRpcProvider>
      </FdeApiProvider>
    </QueryClientProvider>
  );
}
