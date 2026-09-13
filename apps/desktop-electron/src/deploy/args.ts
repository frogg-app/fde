export interface SshTarget {
  host: string;
  sshPort?: number;
  sshPassword?: string;
}
export type DeployMethod = "native" | "docker";
export interface DeployRequest {
  target: SshTarget;
  method: DeployMethod;
  version: string;
  listen: string;
  bundleUrl?: string;
}
export interface DeployBrand {
  envPrefix: string;
  daemonPort: number;
  releaseBase: string | null;
}

export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Deploy arguments must be an object.");
  return input as Record<string, unknown>;
}
function text(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}
function hasUnsafeCharacters(value: string, forbidden: RegExp): boolean {
  return (
    forbidden.test(value) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}
export function parseTarget(input: unknown): SshTarget {
  const args = record(input);
  const host = text(args.host);
  if (!host) throw new Error("SSH host is required");
  if (host.startsWith("-") || hasUnsafeCharacters(host, /\s/u))
    throw new Error("SSH host is invalid");
  const sshPort = args.sshPort;
  if (
    sshPort != null &&
    (typeof sshPort !== "number" || !Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)
  )
    throw new Error("SSH port must be between 1 and 65535.");
  return {
    host,
    ...(sshPort == null ? {} : { sshPort: sshPort as number }),
    ...(typeof args.sshPassword === "string" && args.sshPassword
      ? { sshPassword: args.sshPassword }
      : {}),
  };
}
export function parseMethod(input: unknown): DeployMethod {
  const method = text(record(input).method) || "native";
  if (method !== "native" && method !== "docker")
    throw new Error(`Unknown deploy method: ${method}`);
  return method;
}
export function parseRequest(
  input: unknown,
  defaultVersion: string,
  brand: DeployBrand,
): DeployRequest {
  const args = record(input);
  const target = parseTarget(args);
  const method = parseMethod(args);
  const version = (text(args.version) || defaultVersion).replace(/^v+/u, "");
  if (!/^[A-Za-z0-9.+_-]{1,64}$/u.test(version)) throw new Error("Version is invalid");
  const listen = text(args.listen) || `0.0.0.0:${brand.daemonPort}`;
  const split = listen.lastIndexOf(":");
  const host = listen.slice(0, split);
  const port = listen.slice(split + 1);
  if (
    split < 1 ||
    hasUnsafeCharacters(host, /[\s'"]/u) ||
    !/^\d+$/u.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    throw new Error("Listen address must be host:port");
  const bundleUrl = text(args.bundleUrl) || undefined;
  if (bundleUrl) {
    let url: URL;
    try {
      url = new URL(bundleUrl);
    } catch {
      throw new Error("Bundle URL must be an http(s) URL");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      bundleUrl.length > 2048 ||
      hasUnsafeCharacters(bundleUrl, /[\s']/u)
    )
      throw new Error("Bundle URL must be an http(s) URL");
  }
  return { target, method, version, listen, bundleUrl };
}
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export function buildInstallCommand(request: DeployRequest, brand: DeployBrand): string {
  const values: Record<string, string> = { VERSION: request.version };
  if (request.method === "native") {
    values.LISTEN = request.listen;
    if (brand.releaseBase) values.RELEASE_BASE = brand.releaseBase;
    if (request.bundleUrl) values.BUNDLE_URL = request.bundleUrl;
    if (!brand.releaseBase && !request.bundleUrl)
      throw new Error("This distribution has no daemon release URL.");
  } else {
    const split = request.listen.lastIndexOf(":");
    values.BIND = request.listen.slice(0, split);
    values.PORT = request.listen.slice(split + 1);
  }
  return `${Object.entries(values)
    .map(([key, value]) => `${brand.envPrefix}_${key}=${shellQuote(value)}`)
    .join(" ")} bash -s`;
}
export function buildSshArgs(target: SshTarget, command: string): string[] {
  return [
    "-T",
    "-o",
    ...(target.sshPassword
      ? [
          "NumberOfPasswordPrompts=1",
          "-o",
          "PreferredAuthentications=publickey,keyboard-interactive,password",
        ]
      : ["BatchMode=yes"]),
    "-o",
    "ConnectTimeout=10",
    ...(target.sshPort ? ["-p", String(target.sshPort)] : []),
    target.host,
    command,
  ];
}
