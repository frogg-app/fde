// xterm.write queues text until its asynchronous parser consumes it. Pause the
// PTY's readable socket while that queue is full so output stays in the OS pipe
// instead of accumulating strings and completion callbacks in the worker heap.
const HIGH_WATER_CHARS = 1024 * 1024;
const LOW_WATER_CHARS = 256 * 1024;

interface TerminalOutputPorts {
  source: { pause(): void; resume(): void };
  parser: { write(data: string, onParsed: () => void): void };
}

export class TerminalOutputFlow {
  private pendingChars = 0;
  private paused = false;
  private disposed = false;

  private readonly ports: TerminalOutputPorts;

  constructor(ports: TerminalOutputPorts) {
    this.ports = ports;
  }

  write(data: string, onParsed: () => void): void {
    if (this.disposed) return;
    this.pendingChars += data.length;
    if (!this.paused && this.pendingChars >= HIGH_WATER_CHARS) {
      this.paused = true;
      this.ports.source.pause();
    }
    this.ports.parser.write(data, () => {
      if (this.disposed) return;
      this.pendingChars -= data.length;
      // Publish this parsed output before resuming the producer, preserving the
      // revision and snapshot ordering of the terminal session.
      try {
        onParsed();
      } finally {
        if (!this.disposed && this.paused && this.pendingChars <= LOW_WATER_CHARS) {
          this.paused = false;
          this.ports.source.resume();
        }
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.pendingChars = 0;
    // The session owns PTY teardown; a late parser callback must not restart it.
  }
}
