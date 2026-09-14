import { describe, expect, test } from "vitest";
import { createdAtFields, projectCreatedAtField } from "./workspace-created-at.js";

describe("workspace creation time fields", () => {
  test("passes valid registry timestamps through", () => {
    expect(createdAtFields("2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z")).toEqual({
      createdAt: "2026-01-01T00:00:00.000Z",
      projectCreatedAt: "2025-01-01T00:00:00.000Z",
    });
  });

  test("omits missing or unparseable values instead of sending junk", () => {
    expect(createdAtFields("", null)).toEqual({});
    expect(createdAtFields("not a date", undefined)).toEqual({});
    expect(projectCreatedAtField("garbage")).toEqual({});
  });
});
