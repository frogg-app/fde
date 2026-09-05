import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const SYSTEM = process.env.PROBE_SYSTEM ?? "You are a terse assistant.";
const t0 = Date.now();
const el = () => Date.now() - t0;

function mkTools() {
  const names = [
    "list_workspaces",
    "list_agents",
    "get_agent_status",
    "send_agent_prompt",
    "create_agent",
    "cancel_agent",
    "note",
    "think",
    "read_timeline",
    "research",
  ];
  return names.map((n) =>
    tool(
      n,
      `Companion tool ${n}`,
      { id: z.string().optional(), text: z.string().optional() },
      async () => ({ content: [{ type: "text", text: "{}" }] }),
    ),
  );
}

const queue = [];
let notify = null;
function push(msg) {
  queue.push(msg);
  notify?.();
}
async function* input() {
  for (;;) {
    while (queue.length) yield queue.shift();
    await new Promise((r) => {
      notify = r;
    });
    notify = null;
  }
}

const q = query({
  prompt: input(),
  options: {
    model: "claude-haiku-4-5",
    systemPrompt: SYSTEM,
    includePartialMessages: true,
    tools: [],
    persistSession: false,
    settingSources: [],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    mcpServers: {
      companion: createSdkMcpServer({ name: "companion", version: "1.0.0", tools: mkTools() }),
    },
    cwd: "/tmp",
    strictMcpConfig: true,
  },
});

let firstDelta = null;
const marks = [];
let resolveTurn = null;

(async () => {
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init")
      marks.push(["init", el(), m.mcp_servers?.map((s) => s.name + ":" + s.status).join(",")]);
    if (
      m.type === "stream_event" &&
      m.event.type === "content_block_start" &&
      m.event.content_block.type === "tool_use"
    )
      marks.push(["tool_start", el(), m.event.content_block.name]);
    if (
      m.type === "stream_event" &&
      m.event.type === "content_block_delta" &&
      m.event.delta.type === "text_delta"
    ) {
      if (firstDelta === null) {
        firstDelta = el();
        marks.push(["first_delta", firstDelta]);
      }
    }
    if (m.type === "result") {
      marks.push([
        "result",
        el(),
        "ttft",
        m.ttft_ms,
        "ttft_stream",
        m.ttft_stream_ms,
        "to_request",
        m.time_to_request_ms,
        "api",
        m.duration_api_ms,
        "cacheR",
        m.usage?.cache_read_input_tokens,
        "cacheW",
        m.usage?.cache_creation_input_tokens,
      ]);
      resolveTurn?.();
    }
  }
})();

function send(text) {
  firstDelta = null;
  const done = new Promise((r) => {
    resolveTurn = r;
  });
  push({ type: "user", parent_tool_use_id: null, message: { role: "user", content: text } });
  return done;
}

const WARM = process.env.PROBE_WARM ?? "turn";
if (WARM === "spawn") {
  // just let the process boot; wait for nothing
  await new Promise((r) => setTimeout(r, 6000));
  marks.push(["spawn_wait_done", el()]);
} else if (WARM === "turn") {
  const n = Number(process.env.PROBE_WARM_TURNS ?? 1);
  for (let i = 0; i < n; i += 1) {
    const s = el();
    await send("Your notebook is empty.\n\nThey said: are you there?");
    marks.push(["warm_turn_total", el() - s]);
  }
}

for (const p of [
  "how many agents are running?",
  "which ones are idle?",
  "what about the auth one?",
  "and the push test?",
]) {
  await new Promise((r) => setTimeout(r, Number(process.env.PROBE_GAP_MS ?? 0)));
  const s = el();
  await send(p);
  marks.push([
    "turn",
    p,
    "first_delta_ms",
    firstDelta === null ? null : firstDelta - s,
    "total_ms",
    el() - s,
  ]);
}
console.log(JSON.stringify(marks, null, 1));
process.exit(0);
