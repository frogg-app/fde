/** Public installer endpoints serve the exact scripts embedded in this distribution. */
import { brand } from "@fde/branding";
import { installers } from "@fde/branding/installers";

export interface InstallScriptWorkerEnv {
  /** Edge/browser cache duration. Scripts never fetch an upstream source template. */
  FDE_INSTALL_CACHE_SECONDS?: string;
}
export async function handleInstallScriptRequest(
  request: Request,
  env: InstallScriptWorkerEnv = {},
): Promise<Response> {
  const headers = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed\n", {
      status: 405,
      headers: { ...headers, Allow: "GET, HEAD" },
    });
  }
  const body = installers[new URL(request.url).pathname];
  if (!body) return new Response("Not found\n", { status: 404, headers });
  const configured = Number(env.FDE_INSTALL_CACHE_SECONDS ?? 300);
  const seconds =
    Number.isFinite(configured) && configured >= 0 ? Math.min(configured, 86400) : 300;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": `public, max-age=${seconds}`,
      "X-Distribution-Identity": brand.applicationId,
    },
  });
}
export default { fetch: handleInstallScriptRequest };
