import { brand } from "@fde/branding";
import { afterEach, describe, expect, test, vi } from "vitest";
import { probeDaemon } from "./verify.js";

afterEach(() => vi.unstubAllGlobals());

describe("update gateway verification", () => {
  test.each([null, "0.4.3"])(
    "verifies installed gateway header %s while retaining backend version",
    async (gateway) => {
      const headers = new Headers();
      if (gateway) headers.set("x-fde-gateway-version", gateway);
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ version: "0.4.2", brand }), {
              headers,
            }),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }))),
      );
      await expect(probeDaemon("http://127.0.0.1:1")).resolves.toEqual({
        version: gateway ?? "0.4.2",
        healthy: true,
      });
    },
  );
});
