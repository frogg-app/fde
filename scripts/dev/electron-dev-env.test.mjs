import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { electronDevEnvironment } from "./electron-dev-env.mjs";

test("custom-brand daemon overrides inherited live state and ports", () => {
  const state = path.resolve(".dev/electron");
  const env = electronDevEnvironment({
    state,
    port: 18234,
    brand: { envPrefix: "ACME" },
    env: { ACME_HOME: "/live/acme", ACME_LISTEN: "0.0.0.0:9999", PATH: "/test/bin" },
  });
  assert.equal(env.ACME_HOME, path.join(state, "daemon"));
  assert.equal(env.ACME_LISTEN, "0.0.0.0:0");
  assert.equal(env.FDE_HOME, env.ACME_HOME);
  assert.equal(env.PASEO_HOME, env.ACME_HOME);
  assert.equal(env.FDE_ELECTRON_USER_DATA_DIR, path.join(state, "profile"));
  assert.equal(env.PATH, "/test/bin");
});

test("official-brand daemon also overrides inherited primary listen variable", () => {
  const env = electronDevEnvironment({
    state: "/isolated",
    port: 18235,
    brand: { envPrefix: "FDE" },
    env: { FDE_LISTEN: "0.0.0.0:9999" },
  });
  assert.equal(env.FDE_LISTEN, "0.0.0.0:0");
  assert.equal(env.PASEO_LISTEN, "0.0.0.0:0");
});
