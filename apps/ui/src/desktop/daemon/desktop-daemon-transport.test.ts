import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopDaemonTransportUrl,
  buildOpenSessionInput,
  createDesktopDaemonTransportFactory,
  DesktopTransportError,
} from "./desktop-daemon-transport";
import { clearSessionSshPasswords, rememberSessionSshPassword } from "./ssh-session-passwords";
import { createFakeLocalDaemonTransportRpc } from "./test-local-daemon-transport-rpc";

const LOCAL_URL = "paseo+desktop://socket?path=%2Ftmp%2Fpaseo.sock";

describe("desktop-daemon-transport", () => {
  it("uses the main-process event as readiness when it races registration", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const cleanup = vi.fn();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });

    const onOpen = vi.fn();
    transport.onOpen(onOpen);

    rpc.resolveListen(cleanup);
    await Promise.resolve();

    const sessionId = rpc.openCalls[0]?.sessionId ?? "";
    expect(sessionId).not.toBe("");
    rpc.emitEvent({ sessionId, kind: "open" });
    expect(onOpen).toHaveBeenCalledTimes(1);

    rpc.resolveRegistration();
    await Promise.resolve();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not start a session when listener setup finishes after close", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const cleanup = vi.fn();

    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });

    transport.close();

    rpc.resolveListen(cleanup);
    await Promise.resolve();
    await Promise.resolve();

    expect(rpc.openCalls).toHaveLength(0);
    expect(rpc.closedSessions).toHaveLength(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cancels a registered session while readiness is pending", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });
    rpc.resolveListen(vi.fn());
    await Promise.resolve();

    const sessionId = rpc.openCalls[0]?.sessionId ?? "";
    expect(sessionId).not.toBe("");

    transport.close();

    expect(rpc.closedSessions).toEqual([sessionId]);
  });

  it("passes Remote SSH parameters to the desktop transport bridge", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const url = buildDesktopDaemonTransportUrl({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort: 2222,
      daemonPort: 7777,
    });
    transportFactory!({ url });
    rpc.resolveListen(vi.fn());
    await Promise.resolve();

    expect(rpc.openCalls).toHaveLength(1);
    expect(rpc.openCalls[0]?.target).toEqual({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort: 2222,
      daemonPort: 7777,
    });
  });

  it("forwards the daemon password subprotocol and the session ssh password", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    rememberSessionSshPassword({ host: "deploy@example.com", sshPort: 2222 }, "hunter2");
    try {
      const url = buildDesktopDaemonTransportUrl({
        transportType: "ssh",
        host: "deploy@example.com",
        sshPort: 2222,
      });
      // The ssh password never travels in the URL.
      expect(url).not.toContain("hunter2");
      transportFactory!({ url, protocols: ["paseo.bearer.daemon-pw"] });
      rpc.resolveListen(vi.fn());
      await Promise.resolve();

      expect(rpc.openCalls[0]).toEqual({
        sessionId: expect.stringMatching(/^local-session-/u),
        target: {
          transportType: "ssh",
          host: "deploy@example.com",
          sshPort: 2222,
          sshPassword: "hunter2",
        },
        protocols: ["paseo.bearer.daemon-pw"],
      });
    } finally {
      clearSessionSshPasswords();
    }
  });

  it("leaves out the ssh password and protocols when there are none", () => {
    expect(
      buildOpenSessionInput({
        sessionId: "s",
        url: buildDesktopDaemonTransportUrl({ transportType: "ssh", host: "box" }),
        protocols: [],
        sessionSshPassword: () => undefined,
      }),
    ).toEqual({ sessionId: "s", target: { transportType: "ssh", host: "box" } });
    expect(
      buildOpenSessionInput({ sessionId: "s", url: LOCAL_URL, protocols: ["x"] }).target,
    ).toEqual({ transportType: "socket", transportPath: "/tmp/paseo.sock" });
  });

  it("hands structured error details to the client as an Error", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    const transport = transportFactory!({ url: LOCAL_URL });
    const onError = vi.fn();
    transport.onError(onError);
    rpc.resolveListen(vi.fn());
    await Promise.resolve();
    const sessionId = rpc.openCalls[0]?.sessionId ?? "";
    rpc.emitEvent({
      sessionId,
      kind: "error",
      error: "Permission denied (publickey,password).",
      detail: { kind: "ssh-auth", methods: ["publickey", "password"], passwordTried: false },
    });
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0] as DesktopTransportError;
    expect(error).toBeInstanceOf(DesktopTransportError);
    expect(error.message).toBe("Permission denied (publickey,password).");
    expect(error.detail).toEqual({
      kind: "ssh-auth",
      methods: ["publickey", "password"],
      passwordTried: false,
    });
  });

  it.each([0, 65536])("rejects an out-of-range Remote SSH port (%s)", (sshPort) => {
    const transportFactory = createDesktopDaemonTransportFactory(
      createFakeLocalDaemonTransportRpc(),
    );
    expect(transportFactory).not.toBeNull();

    const url = buildDesktopDaemonTransportUrl({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort,
    });

    expect(() => transportFactory!({ url })).toThrow("Invalid SSH transport target");
  });
});
