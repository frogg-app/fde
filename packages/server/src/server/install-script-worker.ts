/**
 * `https://frogg.app/install.sh` and friends: the short URLs the README and the
 * docs tell people to pipe into bash.
 *
 * The Worker proxies the scripts out of `deploy/` in the public repository
 * rather than redirecting to `raw.githubusercontent.com`, so the bytes people
 * execute come from a hostname this project controls, arrive with a real shell
 * content type, and can be cached at the edge. Swapping where the scripts are
 * fetched from later changes nothing for anyone who has already copied a
 * command out of the README.
 *
 * It deliberately serves a fixed allowlist: a path traversal or a guessed name
 * can never turn this into a general proxy for arbitrary repository contents.
 *
 * `GET /releases/latest/...` is not used as the upstream: while every release
 * is flagged as a pre-release GitHub answers `/releases/latest` with the
 * releases index instead of a release, so the asset URLs 404. See
 * docs/install.md.
 */

export interface InstallScriptWorkerEnv {
  /** `owner/repo` the scripts are fetched from. */
  FDE_INSTALL_REPO?: string;
  /** Branch, tag, or commit to serve. */
  FDE_INSTALL_REF?: string;
  /** Edge cache lifetime, in seconds, for a successfully fetched script. */
  FDE_INSTALL_CACHE_SECONDS?: string;
}

const DEFAULT_REPO = "frogg-app/fde";
const DEFAULT_REF = "main";
const DEFAULT_CACHE_SECONDS = 300;

/**
 * The only paths this Worker answers, mapped to their location in the
 * repository. Anything else is a 404.
 */
const SCRIPTS: Record<string, string> = {
  "/install.sh": "deploy/install.sh",
  "/uninstall.sh": "deploy/uninstall.sh",
  "/install-docker.sh": "deploy/install-docker.sh",
};

/**
 * Plain text, never HTML: whatever this returns may be read in a terminal.
 * `curl -f` suppresses the body on a non-2xx, so an error can never reach a
 * shell as something to execute.
 */
function textResponse(body: string, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

export async function handleInstallScriptRequest(
  request: Request,
  env: InstallScriptWorkerEnv = {},
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse("Method not allowed\n", 405, { Allow: "GET, HEAD" });
  }

  const url = new URL(request.url);
  const scriptPath = SCRIPTS[url.pathname];
  if (!scriptPath) return textResponse("Not found\n", 404);

  const repo = env.FDE_INSTALL_REPO ?? DEFAULT_REPO;
  const ref = env.FDE_INSTALL_REF ?? DEFAULT_REF;
  const cacheSeconds = Number(env.FDE_INSTALL_CACHE_SECONDS ?? DEFAULT_CACHE_SECONDS);
  const upstream = `https://raw.githubusercontent.com/${repo}/${ref}/${scriptPath}`;

  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: { "User-Agent": "fde-install-worker" },
      // `cf` is a Workers extension to RequestInit; the daemon's tsconfig has
      // no Workers types, so it is declared inline rather than pulled in.
      cf: { cacheTtl: Number.isFinite(cacheSeconds) ? cacheSeconds : DEFAULT_CACHE_SECONDS },
    } as RequestInit & { cf: { cacheTtl: number } });
  } catch {
    // Upstream unreachable. A non-2xx means `curl -f` fails and the pipeline
    // into bash gets nothing, which is the outcome we want.
    return textResponse("Could not reach the script source\n", 502);
  }

  if (!response.ok) {
    return textResponse(`Could not fetch ${scriptPath} (upstream ${response.status})\n`, 502);
  }

  const script = await response.text();
  // An empty or truncated body piped into bash is worse than no body at all.
  if (!script.startsWith("#!")) {
    return textResponse("Script source did not look like a shell script\n", 502);
  }

  return new Response(request.method === "HEAD" ? null : script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": `public, max-age=${Number.isFinite(cacheSeconds) ? cacheSeconds : DEFAULT_CACHE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      // So someone debugging a bad install can tell exactly what they ran.
      "X-Fde-Source": `${repo}@${ref}/${scriptPath}`,
    },
  });
}

export default {
  fetch: handleInstallScriptRequest,
};
