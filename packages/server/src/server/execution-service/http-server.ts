import { Server, type IncomingMessage, type RequestListener, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { restoreExecutionRequest } from "./forwarding.js";

/** Gate once, before Express or any WebSocket/service-proxy upgrade listener runs. */
class ExecutionHttpServer extends Server {
  constructor(
    listener: RequestListener,
    private readonly gatewayToken: string,
  ) {
    super(listener);
  }

  override emit(event: string, ...args: unknown[]): boolean {
    if (
      (event === "request" || event === "upgrade") &&
      !restoreExecutionRequest(args[0] as IncomingMessage, this.gatewayToken)
    ) {
      if (event === "request") {
        (args[1] as ServerResponse).writeHead(403).end("Invalid execution gateway request");
      } else {
        (args[1] as Duplex).end(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
      }
      return true;
    }
    return super.emit(event, ...args);
  }
}

export function createExecutionHttpServer(
  listener: RequestListener,
  executionService?: { token: string },
): Server {
  return executionService
    ? new ExecutionHttpServer(listener, executionService.token)
    : new Server(listener);
}
