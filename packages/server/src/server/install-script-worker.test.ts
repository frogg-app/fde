import { afterEach, describe, expect, test, vi } from "vitest";

import { handleInstallScriptRequest } from "./install-script-worker.js";

const ENV = { FDE_INSTALL_REPO: "frogg-app/fde", FDE_INSTALL_REF: "main" };
const SCRIPT = "#!/usr/bin/env bash\nset -euo pipefail\necho install\n";

function stubUpstream(body: string, init: ResponseInit = { status: 200 }) {
  const fetchMock = vi.fn(async () => new Response(body, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function get(path: string, method = "GET"): Promise<Response> {
  return handleInstallScriptRequest(new Request(`https://frogg.app${path}`, { method }), ENV);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("install script worker", () => {
  test("serves each allowlisted script from the repository", async () => {
    for (const [path, expected] of [
      ["/install.sh", "deploy/install.sh"],
      ["/uninstall.sh", "deploy/uninstall.sh"],
      ["/install-docker.sh", "deploy/install-docker.sh"],
    ]) {
      const fetchMock = stubUpstream(SCRIPT);
      const response = await get(path!);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(SCRIPT);
      expect(response.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `https://raw.githubusercontent.com/frogg-app/fde/main/${expected}`,
      );
    }
  });

  test("serves nothing but the allowlist, so it is not a general repo proxy", async () => {
    stubUpstream(SCRIPT);
    for (const path of [
      "/",
      "/install",
      "/deploy/install.sh",
      "/../../packages/server/package.json",
      "/install.sh/extra",
    ]) {
      expect((await get(path)).status).toBe(404);
    }
  });

  test("fails closed when the upstream is missing or unreachable", async () => {
    stubUpstream("not found", { status: 404 });
    expect((await get("/install.sh")).status).toBe(502);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect((await get("/install.sh")).status).toBe(502);
  });

  /** A truncated or replaced body piped into bash is worse than no body. */
  test("refuses a body that is not a shell script", async () => {
    stubUpstream("<!doctype html><title>404</title>");
    const response = await get("/install.sh");

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  test("names the exact source it served, for debugging a bad install", async () => {
    stubUpstream(SCRIPT);
    const response = await get("/install.sh");

    expect(response.headers.get("x-fde-source")).toBe("frogg-app/fde@main/deploy/install.sh");
  });

  test("honours a pinned ref", async () => {
    const fetchMock = stubUpstream(SCRIPT);
    await handleInstallScriptRequest(new Request("https://frogg.app/install.sh"), {
      ...ENV,
      FDE_INSTALL_REF: "v0.1.19",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/frogg-app/fde/v0.1.19/deploy/install.sh");
  });

  test("answers HEAD with headers and no body, and rejects other methods", async () => {
    stubUpstream(SCRIPT);
    const head = await get("/install.sh", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    stubUpstream(SCRIPT);
    const post = await get("/install.sh", "POST");
    expect(post.status).toBe(405);
  });
});
