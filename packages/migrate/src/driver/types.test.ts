import { describe, expect, it } from "vitest";
import { createFakeStore } from "../testing/fake-driver.js";
import { isMigratable } from "./types.js";

describe("isMigratable", () => {
  it("accepts an adapter that exposes a migration driver", () => {
    expect(isMigratable(createFakeStore().adapter)).toBe(true);
  });

  it.each([
    ["no migrations property", {}],
    ["a null driver", { migrations: null }],
    ["a driver without the port methods", { migrations: { applied: () => [] } }],
    [
      "a driver without a journal",
      { migrations: { ...createFakeStore().adapter.migrations, journal: undefined } },
    ],
  ])("rejects %s", (_name, value) => {
    expect(isMigratable(value)).toBe(false);
  });
});
