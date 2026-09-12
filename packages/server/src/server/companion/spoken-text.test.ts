import { expect, it } from "vitest";
import { toSpokenText } from "./spoken-text.js";

it("speaks the words instead of markdown formatting", () => {
  expect(
    toSpokenText(
      "## Result\n- **All twelve tests passed.**\nSee [the report](https://example.com/report).",
    ),
  ).toBe("Result All twelve tests passed. See the report.");
});
it("preserves command content, arithmetic and identifiers", () => {
  expect(
    toSpokenText("Run `npm test`. 2 * 3 = 6. Keep my_variable.\n```sh\nnpm run build\n```"),
  ).toBe("Run npm test. 2 * 3 = 6. Keep my_variable. npm run build");
});
it("does not invent spoken content for formatting-only output", () => {
  expect(toSpokenText("```\n```\n ")).toBe("");
});
