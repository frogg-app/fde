import { describe, expect, it } from "vitest";
import { TerminalOutputFlow } from "./terminal-output-flow.js";

function harness() {
  let paused = false;
  const transitions: string[] = [];
  const writes: Array<{ data: string; onParsed: () => void }> = [];
  const published: string[] = [];
  const flow = new TerminalOutputFlow({
    source: {
      pause() {
        paused = true;
        transitions.push("pause");
      },
      resume() {
        paused = false;
        transitions.push("resume");
      },
    },
    parser: {
      write(data, onParsed) {
        writes.push({ data, onParsed });
      },
    },
  });
  return {
    flow,
    transitions,
    writes,
    published,
    isPaused: () => paused,
    produce(data: string) {
      if (paused) return false;
      flow.write(data, () => published.push(data));
      return true;
    },
    parseNext() {
      const next = writes.shift();
      if (!next) throw new Error("No pending parser write");
      next.onParsed();
    },
  };
}

describe("terminal output flow control", () => {
  it("bounds a stalled parser and resumes only after draining below the low watermark", () => {
    const h = harness();
    const chunk = "x".repeat(256 * 1024);
    for (let index = 0; index < 100; index += 1) h.produce(chunk);
    expect(h.writes).toHaveLength(4);
    expect(h.transitions).toEqual(["pause"]);
    h.parseNext();
    h.parseNext();
    expect(h.isPaused()).toBe(true);
    h.parseNext();
    expect(h.transitions).toEqual(["pause", "resume"]);
    expect(h.produce("later output")).toBe(true);
    h.parseNext();
    h.parseNext();
    expect(h.published).toEqual([chunk, chunk, chunk, chunk, "later output"]);
  });

  it("applies pressure again over repeated bursts without dropping output", () => {
    const h = harness();
    const chunk = "x".repeat(1024 * 1024);
    for (let index = 0; index < 20; index += 1) {
      expect(h.produce(chunk)).toBe(true);
      expect(h.produce("blocked")).toBe(false);
      h.parseNext();
    }
    expect(h.published).toEqual(Array(20).fill(chunk));
    expect(h.transitions).toEqual(Array.from({ length: 20 }, () => ["pause", "resume"]).flat());
  });

  it("does not resume or publish queued output after disposal", () => {
    const h = harness();
    h.produce("x".repeat(1024 * 1024));
    h.flow.dispose();
    h.parseNext();
    h.flow.write("late", () => h.published.push("late"));
    expect(h.transitions).toEqual(["pause"]);
    expect(h.published).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it("allows a synchronous parser to drain without leaving the producer paused", () => {
    const transitions: string[] = [];
    const flow = new TerminalOutputFlow({
      source: { pause: () => transitions.push("pause"), resume: () => transitions.push("resume") },
      parser: { write: (_data, onParsed) => onParsed() },
    });
    flow.write("x".repeat(1024 * 1024), () => transitions.push("parsed"));
    expect(transitions).toEqual(["pause", "parsed", "resume"]);
  });
});
