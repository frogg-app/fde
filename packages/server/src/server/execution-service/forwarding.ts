import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, OutgoingHttpHeaders } from "node:http";
import { isIP } from "node:net";

const PREFIX = "x-frogg-execution-";
const TOKEN = `${PREFIX}token`;
const PEER = `${PREFIX}peer`;

export function executionForwardingHeaders(
  req: IncomingMessage,
  token: string,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!name.startsWith(PREFIX)) headers[name] = value;
  }
  headers[TOKEN] = token;
  headers[PEER] = req.socket.remoteAddress ?? "ipc";
  return headers;
}

/** Restore each request independently: a keep-alive socket can carry different original peers. */
export function restoreExecutionRequest(req: IncomingMessage, token: string): boolean {
  const physicalPeer = physicalPeers.get(req.socket) ?? req.socket.remoteAddress;
  if (!physicalPeers.has(req.socket)) physicalPeers.set(req.socket, physicalPeer);
  // Node caches the original raw-header count for this lazy view. Materialize before filtering.
  const distinctHeaders = req.headersDistinct;
  const privateNames = Object.keys(req.headers).filter((name) => name.startsWith(PREFIX));
  const suppliedToken = req.headers[TOKEN];
  const peer = req.headers[PEER];
  const rawPrivateNames = req.rawHeaders
    .filter((_, index) => index % 2 === 0)
    .map((name) => name.toLowerCase())
    .filter((name) => name.startsWith(PREFIX));
  for (const name of privateNames) delete req.headers[name];
  req.rawHeaders = req.rawHeaders.filter(
    (_, index, all) => !all[index - (index % 2)].toLowerCase().startsWith(PREFIX),
  );
  for (const name of Object.keys(distinctHeaders)) {
    if (name.startsWith(PREFIX)) delete distinctHeaders[name];
  }
  Object.defineProperty(req.socket, "remoteAddress", { configurable: true, value: physicalPeer });
  if (
    physicalPeer !== "127.0.0.1" &&
    physicalPeer !== "::1" &&
    physicalPeer !== "::ffff:127.0.0.1"
  ) {
    return false;
  }
  if (privateNames.length === 0) return true;
  if (
    privateNames.length !== 2 ||
    rawPrivateNames.length !== 2 ||
    typeof suppliedToken !== "string" ||
    typeof peer !== "string" ||
    (peer !== "ipc" && isIP(peer) === 0)
  )
    return false;
  const actual = Buffer.from(suppliedToken);
  const expected = Buffer.from(token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  Object.defineProperty(req.socket, "remoteAddress", {
    configurable: true,
    value: peer === "ipc" ? undefined : peer,
  });
  return true;
}

const physicalPeers = new WeakMap<IncomingMessage["socket"], string | undefined>();
