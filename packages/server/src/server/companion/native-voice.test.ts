import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanionNativeVoice } from "./native-voice.js";

const rpc = vi.hoisted(() => ({
  open: vi.fn(),
  request: vi.fn(),
  dispose: vi.fn(),
  setNotificationHandler: vi.fn(),
  setUnexpectedTerminationHandler: vi.fn(),
}));
vi.mock("./backends/codex.js", () => ({
  openCompanionCodex: rpc.open,
  companionCodexThreadParams: () => ({}),
  installCompanionCodexTools: vi.fn(),
}));

function setup() {
  const onTranscript = vi.fn();
  const onError = vi.fn();
  const voice = createCompanionNativeVoice({
    model: "test",
    tools: [],
    cwd: process.cwd(),
    logger: pino({ level: "silent" }),
    onTranscript,
    onError,
  });
  return { voice, onTranscript, onError };
}

function pendingHandshake({ signal }: { signal: AbortSignal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Handshake cancelled")), {
      once: true,
    });
  });
}

describe("native voice lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.open.mockResolvedValue(rpc);
    rpc.dispose.mockResolvedValue(undefined);
    rpc.request.mockImplementation(async (method: string) =>
      method === "thread/start" ? { thread: { id: "thread-1" } } : {},
    );
  });
  afterEach(() => vi.useRealTimers());

  it("cancels a pending authentication handshake when the conversation ends", async () => {
    rpc.open.mockImplementation(pendingHandshake);
    const { voice } = setup();
    const starting = voice.start("offer");
    const rejected = expect(starting).rejects.toThrow("Handshake cancelled");
    await voice.close();
    await rejected;
    expect(rpc.request).not.toHaveBeenCalled();
  });

  it("cannot open realtime audio after End during thread creation", async () => {
    let finishThread!: (value: unknown) => void;
    rpc.request.mockImplementation((method: string) =>
      method === "thread/start"
        ? new Promise((resolve) => {
            finishThread = resolve;
          })
        : Promise.resolve({}),
    );
    const { voice } = setup();
    const starting = voice.start("offer");
    const rejected = expect(starting).rejects.toThrow("Companion closed");
    await vi.waitFor(() => expect(finishThread).toBeTypeOf("function"));
    await voice.close();
    finishThread({ thread: { id: "thread-1" } });
    await rejected;
    expect(rpc.request.mock.calls.map(([method]) => method)).toEqual(["thread/start"]);
    expect(rpc.dispose).toHaveBeenCalledOnce();
  });

  it("fails negotiation without an SDP answer and closes the owned process", async () => {
    vi.useFakeTimers();
    const { voice } = setup();
    const starting = voice.start("offer");
    const rejected = expect(starting).rejects.toThrow("negotiation timed out");
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    await voice.close();
    expect(rpc.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts only matching thread transcripts and refuses speech after close", async () => {
    const { voice, onTranscript } = setup();
    const starting = voice.start("offer");
    await vi.waitFor(() => expect(rpc.setNotificationHandler).toHaveBeenCalledOnce());
    const notify = rpc.setNotificationHandler.mock.calls[0]![0];
    notify("thread/realtime/sdp", { threadId: "thread-1", sdp: "answer" });
    expect(await starting).toBe("answer");
    notify("thread/realtime/transcript/delta", {
      threadId: "old",
      role: "assistant",
      delta: "stale",
    });
    notify("thread/realtime/transcript/delta", {
      threadId: "thread-1",
      role: "assistant",
      delta: "Hello",
    });
    notify("thread/realtime/transcript/done", { threadId: "thread-1", role: "assistant" });
    expect(onTranscript.mock.calls).toEqual([
      ["assistant", "Hello", false],
      ["assistant", "Hello", true],
    ]);
    await voice.close();
    await expect(voice.appendSpeech("result")).rejects.toThrow("Native voice is closed");
  });
});
