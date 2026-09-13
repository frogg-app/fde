import assert from "node:assert/strict";
import { test } from "node:test";
import { listReleases } from "./verify-release-assets.mjs";

test("release discovery preserves draft and published entries across paginated output", () => {
  const draft = { id: 1, tag_name: "v0.6.13", draft: true, assets: [] };
  const published = { id: 2, tag_name: "v0.6.7", draft: false, assets: [] };
  const result = listReleases((args) => {
    assert.ok(args.includes("--paginate"));
    assert.ok(!args.includes("--slurp"));
    return `${JSON.stringify(draft)}\n${JSON.stringify(published)}\n`;
  }, "frogg-app/fde");
  assert.deepEqual(result, [draft, published]);
});

test("empty release discovery does not manufacture a release", () => {
  assert.deepEqual(
    listReleases(() => "", "frogg-app/fde"),
    [],
  );
});
