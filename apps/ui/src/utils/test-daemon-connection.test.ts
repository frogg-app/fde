import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClientConfig } from "@frogg/client/internal/daemon-client";
import type { DaemonConnectionDependencies, DaemonProbeClient } from "./test-daemon-connection";

class FakeDaemonClient implements DaemonProbeClient {
  readonly lastError: string | null;

  constructor(
    private readonly probe: FakeDaemonProbe,
    readonly config: DaemonClientConfig,
  ) {
    this.lastError = probe.nextLastError;
  }

  async connect(): Promise<void> {
    if (this.probe.nextConnectError) {
      throw this.probe.nextConnectError;
    }
  }

  getLastServerInfoMessage() {
    return {
      serverId: "srv_probe_test",
      hostname: "probe-host",
    };
  }

  async close(): Promise<void> {
    this.probe.closedClients.push(this);
  }
}

class FakeDaemonProbe {
  createdClients: FakeDaemonClient[] = [];
  closedClients: FakeDaemonClient[] = [];
  clientIdsRequested = 0;
  nextConnectError: Error | null = null;
  nextLastError: string | null = null;

  readonly deps: DaemonConnectionDependencies<FakeDaemonClient> = {
    getClientId: async () => {
      this.clientIdsRequested += 1;
      return "cid_shared_probe_test";
    },
    resolveAppVersion: () => null,
    createDesktopTransportFactory: () => null,
    buildDesktopTransportUrl: (target) => {
      if (target.transportType === "ssh") {
        return `frogg+desktop://ssh?host=${encodeURIComponent(target.host)}`;
      }
      return `frogg+desktop://${target.transportType}?path=${encodeURIComponent(target.transportPath)}`;
    },
    createClient: (config) => {
      const client = new FakeDaemonClient(this, config);
      this.createdClients.push(client);
      return client;
    },
  };

  failNextConnection(error: Error, lastError: string | null): void {
    this.nextConnectError = error;
    this.nextLastError = lastError;
  }

  createdConfigs(): DaemonClientConfig[] {
    return this.createdClients.map((client) => client.config);
  }
}

describe("test-daemon-connection connectToDaemon", () => {
  let probe: FakeDaemonProbe;
  let connectToDaemon: typeof import("./test-daemon-connection").connectToDaemon;

  beforeAll(async () => {
    vi.stubGlobal("__DEV__", false);
    // Imported here rather than at the top so __DEV__ is already false when the
    // module first evaluates, and hoisted out of the tests so only one of them
    // pays for transforming the graph. Cold, that transform runs past the
    // default 5s test timeout, which failed whichever test happened to import
    // first - visible when this file runs alone or in a shard, and masked in a
    // full run by another file having warmed the module already.
    ({ connectToDaemon } = await import("./test-daemon-connection"));
  }, 60_000);

  beforeEach(() => {
    vi.stubGlobal("__DEV__", false);
    probe = new FakeDaemonProbe();
  });

  it("reuses the app clientId for direct connections", async () => {
    const first = await connectToDaemon(
      {
        id: "direct:lan:9999",
        type: "directTcp",
        endpoint: "lan:9999",
      },
      undefined,
      probe.deps,
    );
    await first.client.close();

    const second = await connectToDaemon(
      {
        id: "direct:lan:9999",
        type: "directTcp",
        endpoint: "lan:9999",
      },
      undefined,
      probe.deps,
    );
    await second.client.close();

    const [firstConfig, secondConfig] = probe.createdConfigs();
    expect(firstConfig?.clientId).toBe("cid_shared_probe_test");
    expect(secondConfig?.clientId).toBe("cid_shared_probe_test");
    expect(probe.clientIdsRequested).toBe(2);
  });

  it("keeps direct TCP probes on the renderer WebSocket", async () => {
    const deps = {
      ...probe.deps,
      createWebSocketTransportFactory: () => {
        throw new Error("Direct TCP must not use the desktop WebSocket bridge");
      },
    };

    const result = await connectToDaemon(
      {
        id: "direct:lan:9999",
        type: "directTcp",
        endpoint: "lan:9999",
      },
      undefined,
      deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.transportFactory).toBeUndefined();
  });

  it("encodes the local socket target into the client config", async () => {
    const result = await connectToDaemon(
      {
        id: "socket:/tmp/frogg.sock",
        type: "directSocket",
        path: "/tmp/frogg.sock",
      },
      undefined,
      probe.deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.url).toBe("frogg+desktop://socket?path=%2Ftmp%2Ffrogg.sock");
  });

  it("uses the desktop transport for Remote SSH connections", async () => {
    const transportFactory = vi.fn();
    const result = await connectToDaemon(
      {
        id: "ssh:deploy%40example.com:2222:%2Fkeys%2Ffrogg",
        type: "remoteSsh",
        host: "deploy@example.com",
        sshPort: 2222,
        daemonPort: 7777,
      },
      undefined,
      {
        ...probe.deps,
        createDesktopTransportFactory: () => transportFactory,
      },
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]).toMatchObject({
      url: "frogg+desktop://ssh?host=deploy%40example.com",
      transportFactory,
      // Above the shell's 18 s SSH setup window, so ssh's stderr wins over the timer.
      connectTimeoutMs: 20_000,
    });
  });

  it("passes direct TCP connection passwords into the client config", async () => {
    const result = await connectToDaemon(
      {
        id: "direct:lan:9999",
        type: "directTcp",
        endpoint: "lan:9999",
        password: "shared-secret",
      },
      undefined,
      probe.deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.password).toBe("shared-secret");
  });

  it("passes performance tracing into the connected client", async () => {
    const trace = {
      isEnabled: () => true,
      beginSection: vi.fn(),
      endSection: vi.fn(),
    };
    const result = await connectToDaemon(
      {
        id: "direct:lan:9999",
        type: "directTcp",
        endpoint: "lan:9999",
      },
      { trace },
      probe.deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.trace).toBe(trace);
  });

  it("uses relay TLS from the stored connection", async () => {
    const tlsResult = await connectToDaemon(
      {
        id: "relay:wss:[::1]:443",
        type: "relay",
        relayEndpoint: "[::1]:443",
        useTls: true,
        daemonPublicKeyB64: "pubkey",
      },
      { serverId: "srv_probe_test" },
      probe.deps,
    );
    await tlsResult.client.close();

    const plainResult = await connectToDaemon(
      {
        id: "relay:relay.example.com:443",
        type: "relay",
        relayEndpoint: "relay.example.com:443",
        useTls: false,
        daemonPublicKeyB64: "pubkey",
      },
      { serverId: "srv_probe_test" },
      probe.deps,
    );
    await plainResult.client.close();

    expect(probe.createdConfigs()[0]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
    expect(probe.createdConfigs()[1]?.url).toMatch(/^ws:\/\/relay\.example\.com:443\/ws\?/);
  });

  it("surfaces auth rejection as an incorrect password", async () => {
    probe.failNextConnection(
      new Error("Transport closed (code 4001)"),
      "Transport closed (code 4001)",
    );

    await expect(
      connectToDaemon(
        {
          id: "direct:lan:9999",
          type: "directTcp",
          endpoint: "lan:9999",
          password: "wrong-secret",
        },
        undefined,
        probe.deps,
      ),
    ).rejects.toMatchObject({
      message: "Incorrect password",
    });
  });

  it("keeps generic transport failures generic when a password was supplied", async () => {
    probe.failNextConnection(new Error("Transport error"), "Transport error");

    await expect(
      connectToDaemon(
        {
          id: "direct:lan:9999",
          type: "directTcp",
          endpoint: "lan:9999",
          password: "shared-secret",
        },
        undefined,
        probe.deps,
      ),
    ).rejects.toMatchObject({
      message: "Transport error",
    });
  });
  it("explains a pre-0.6 daemon after a failed manual direct connection", async () => {
    probe.failNextConnection(new Error("Transport closed (code 1006)"), null);
    const urls: string[] = [];
    await expect(
      connectToDaemon(
        {
          id: "direct:lan:9999",
          type: "directTcp",
          endpoint: "lan:9999",
        },
        undefined,
        {
          ...probe.deps,
          readDirectDaemonVersion: async (url) => {
            urls.push(url);
            return "0.3.1";
          },
        },
      ),
    ).rejects.toMatchObject({
      message:
        "This host is running daemon 0.3.1. This app requires daemon 0.6.0 or later. Update the daemon on this host and restart its service, then connect again. If you already installed an update, the old daemon is still running.",
      lastError: "Transport closed (code 1006)",
    });
    expect(urls).toEqual(["ws://lan:9999/ws"]);
    expect(probe.closedClients).toHaveLength(1);
  });

  it.each([null, "0.6.7"])(
    "preserves the connection failure when daemon version is %s",
    async (version) => {
      probe.failNextConnection(new Error("Transport closed (code 1006)"), null);
      await expect(
        connectToDaemon(
          {
            id: "direct:lan:9999",
            type: "directTcp",
            endpoint: "lan:9999",
          },
          undefined,
          { ...probe.deps, readDirectDaemonVersion: async () => version },
        ),
      ).rejects.toMatchObject({ message: "Transport closed (code 1006)" });
    },
  );

  it("does not probe identity on a successful direct connection", async () => {
    const urls: string[] = [];
    const result = await connectToDaemon(
      {
        id: "direct:lan:9999",
        type: "directTcp",
        endpoint: "lan:9999",
      },
      undefined,
      {
        ...probe.deps,
        readDirectDaemonVersion: async (url) => {
          urls.push(url);
          return "0.3.1";
        },
      },
    );
    expect(result.serverId).toBe("srv_probe_test");
    expect(urls).toEqual([]);
    await result.client.close();
  });
});
