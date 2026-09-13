import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { generateKeyPair } from "@frogg/relay";
import { createRelayRuntime } from "./relay-runtime.js";
import { startRelayTransport, type RelayTransportController } from "./relay-transport.js";

describe("RelayRuntime", () => {
  test("starts and stops transport as enabled state changes", async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const starts: string[] = [];
    const startTransport: typeof startRelayTransport = (options) => {
      starts.push(options.relayEndpoint);
      const stop = vi.fn(async () => undefined);
      stops.push(stop);
      return { stop } satisfies RelayTransportController;
    };
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "relay.example.test:443",
        publicEndpoint: "relay.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport,
    });

    expect(starts).toEqual([]);
    runtime.setEnabled(true);
    runtime.setEnabled(true);
    expect(starts).toEqual(["relay.example.test:443"]);
    expect(runtime.getConfig().enabled).toBe(true);

    runtime.setEnabled(false);
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalledOnce());
    expect(runtime.getConfig().enabled).toBe(false);
  });

  test("keeps relay disabled when transport startup fails", () => {
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "invalid-endpoint",
        publicEndpoint: "invalid-endpoint",
        useTls: false,
        publicUseTls: false,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport: () => {
        throw new Error("Invalid relay endpoint");
      },
    });

    expect(() => runtime.setEnabled(true)).toThrow("Invalid relay endpoint");
    expect(runtime.getConfig().enabled).toBe(false);
  });

  test("does not start a transport when enabled without an endpoint", () => {
    const starts: string[] = [];
    const warn = vi.fn();
    const logger = pino({ level: "silent" });
    logger.warn = warn as unknown as typeof logger.warn;
    const runtime = createRelayRuntime({
      config: { enabled: true, endpoint: "", publicEndpoint: "", useTls: true, publicUseTls: true },
      logger,
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport: (options) => {
        starts.push(options.relayEndpoint);
        return { stop: async () => undefined };
      },
    });

    expect(starts).toEqual([]);
    expect(warn).toHaveBeenCalled();
    runtime.setEnabled(false);
    runtime.setEnabled(true);
    expect(starts).toEqual([]);
    expect(runtime.getConfig().enabled).toBe(true);
  });

  test("restarts the transport when the endpoint changes and stops on an empty endpoint", async () => {
    const starts: Array<{ endpoint: string; useTls: boolean }> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const runtime = createRelayRuntime({
      config: {
        enabled: true,
        endpoint: "",
        publicEndpoint: "",
        useTls: true,
        publicUseTls: true,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport: (options) => {
        starts.push({ endpoint: options.relayEndpoint, useTls: options.relayUseTls });
        const stop = vi.fn(async () => undefined);
        stops.push(stop);
        return { stop };
      },
    });

    runtime.setEndpoint({ endpoint: "a.example.test:443", useTls: true });
    runtime.setEndpoint({ endpoint: "a.example.test:443", useTls: true });
    expect(starts).toEqual([{ endpoint: "a.example.test:443", useTls: true }]);
    expect(runtime.getConfig()).toMatchObject({
      endpoint: "a.example.test:443",
      publicEndpoint: "a.example.test:443",
    });

    runtime.setEndpoint({ endpoint: "b.example.test:8080", useTls: false });
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalledOnce());
    expect(starts[1]).toEqual({ endpoint: "b.example.test:8080", useTls: false });
    expect(runtime.getConfig()).toMatchObject({
      publicEndpoint: "b.example.test:8080",
      publicUseTls: false,
    });

    runtime.setEndpoint({ endpoint: "", useTls: false });
    await vi.waitFor(() => expect(stops[1]).toHaveBeenCalledOnce());
    expect(starts).toHaveLength(2);
    expect(runtime.getConfig().enabled).toBe(true);
  });

  test("updates the endpoint without starting while disabled", () => {
    const starts: string[] = [];
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "a.example.test:443",
        publicEndpoint: "public.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport: (options) => {
        starts.push(options.relayEndpoint);
        return { stop: async () => undefined };
      },
    });

    runtime.setEndpoint({ endpoint: "b.example.test:443", useTls: true });
    expect(starts).toEqual([]);
    // An explicitly distinct public endpoint is preserved.
    expect(runtime.getConfig()).toMatchObject({
      endpoint: "b.example.test:443",
      publicEndpoint: "public.example.test:443",
    });
    runtime.setEnabled(true);
    expect(starts).toEqual(["b.example.test:443"]);
  });
});
