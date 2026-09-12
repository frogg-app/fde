import { z } from "zod";
import type { CodexAppServerClient } from "../agent/providers/codex/app-server-transport.js";
import {
  openCompanionCodex,
  companionCodexThreadParams,
  installCompanionCodexTools,
  type CompanionCodexOptions,
} from "./backends/codex.js";

export interface CompanionNativeVoice {
  start(sdp: string): Promise<string>;
  appendSpeech(text: string): Promise<void>;
  close(): Promise<void>;
}

export interface CompanionNativeVoiceOptions extends CompanionCodexOptions {
  onTranscript(role: "user" | "assistant", text: string, isFinal: boolean): void;
  onError(error: unknown): void;
}

/** Experimental transport is isolated from the text backend and never accesses OAuth tokens. */
export function createCompanionNativeVoice(
  options: CompanionNativeVoiceOptions,
): CompanionNativeVoice {
  let client: CodexAppServerClient | null = null;
  let threadId: string | null = null;
  let closed = false;
  let rejectStart: ((error: Error) => void) | null = null;
  const transcript = { user: "", assistant: "" };
  const startup = new AbortController();
  return {
    async start(sdp) {
      const rpc = await openCompanionCodex({ ...options, signal: startup.signal });
      if (closed) {
        await rpc.dispose();
        throw new Error("Companion closed");
      }
      client = rpc;
      installCompanionCodexTools(rpc, options.tools);
      threadId = z
        .object({ thread: z.object({ id: z.string() }) })
        .parse(await rpc.request("thread/start", companionCodexThreadParams(options), 20000))
        .thread.id;
      if (closed) throw new Error("Companion closed");
      const answer = new Promise<string>((resolve, reject) => {
        rejectStart = reject;
        rpc.setUnexpectedTerminationHandler((error) => {
          reject(error);
          options.onError(error);
        });
        rpc.setNotificationHandler((method, params) => {
          const parsed = z
            .object({
              threadId: z.string(),
              sdp: z.string().optional(),
              role: z.enum(["user", "assistant"]).optional(),
              delta: z.string().optional(),
              text: z.string().optional(),
              error: z.unknown().optional(),
            })
            .safeParse(params);
          if (!parsed.success || parsed.data.threadId !== threadId) return;
          const event = parsed.data;
          if (method === "thread/realtime/sdp" && event.sdp) resolve(event.sdp);
          if (method === "thread/realtime/error") {
            const error = new Error(
              "Codex native voice is unavailable for this account or CLI version.",
            );
            reject(error);
            options.onError(error);
          }
          if (event.role && method === "thread/realtime/transcript/delta") {
            transcript[event.role] += event.delta ?? "";
            options.onTranscript(event.role, transcript[event.role], false);
          }
          if (event.role && method === "thread/realtime/transcript/done") {
            options.onTranscript(event.role, event.text ?? transcript[event.role], true);
            transcript[event.role] = "";
          }
        });
      });
      // Consume early errors while the start RPC is still pending.
      void answer.catch(() => undefined);
      const timer = setTimeout(
        () => rejectStart?.(new Error("Codex native voice negotiation timed out")),
        20000,
      );
      try {
        await rpc.request(
          "thread/realtime/start",
          {
            threadId,
            version: "v3",
            outputModality: "audio",
            transport: { type: "webrtc", sdp },
            includeStartupContext: false,
            clientManagedHandoffs: false,
            codexResponseHandoffMode: "commentary",
            prompt:
              "You are Companion, a concise voice assistant for coding and other tasks. Keep conversing while work runs. Delegate tasks, status checks and permissions to your backing agent. Speak returned results. Never claim work succeeded before a tool confirms it. When asked to end the conversation, delegate to end_conversation.",
          },
          20000,
        );
        return await answer;
      } finally {
        clearTimeout(timer);
        rejectStart = null;
      }
    },
    async appendSpeech(text) {
      if (!client || !threadId || closed) throw new Error("Native voice is closed");
      await client.request("thread/realtime/appendSpeech", { threadId, text }, 10000);
    },
    async close() {
      closed = true;
      startup.abort();
      rejectStart?.(new Error("Companion closed"));
      const rpc = client;
      client = null;
      if (rpc && threadId)
        await rpc.request("thread/realtime/stop", { threadId }, 2000).catch(() => undefined);
      await rpc?.dispose();
    },
  };
}
