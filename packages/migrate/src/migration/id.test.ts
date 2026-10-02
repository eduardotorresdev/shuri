import { describe, expect, it } from "vitest";
import { InvalidMigrationNameError } from "../errors.js";
import { compareIds, newMigrationId, slugifyName } from "./id.js";
import { MIGRATION_ID_PATTERN } from "./types.js";

describe("MIGRATION_ID_PATTERN", () => {
  it.each(["20261002T153012000Z_1a2b_add_price", "20261002T153012000Z_ffff_a"])(
    "accepts %s",
    (id) => expect(MIGRATION_ID_PATTERN.test(id)).toBe(true),
  );

  it.each([
    ["no millis", "20261002T153012Z_1a2b_add"],
    ["uppercase hex", "20261002T153012000Z_1A2B_add"],
    ["3 hex digits", "20261002T153012000Z_1a2_add"],
    ["5 hex digits", "20261002T153012000Z_1a2b3_add"],
    ["uppercase name", "20261002T153012000Z_1a2b_Add"],
    ["dash in name", "20261002T153012000Z_1a2b_add-price"],
    ["empty name", "20261002T153012000Z_1a2b_"],
    ["65-char name", `20261002T153012000Z_1a2b_${"a".repeat(65)}`],
    ["trailing junk", "20261002T153012000Z_1a2b_add\n"],
    ["empty", ""],
  ])("rejects %s", (_label, id) => expect(MIGRATION_ID_PATTERN.test(id)).toBe(false));

  it("accepts a 64-char name", () => {
    expect(MIGRATION_ID_PATTERN.test(`20261002T153012000Z_1a2b_${"a".repeat(64)}`)).toBe(
      true,
    );
  });
});

describe("slugifyName", () => {
  it.each([
    ["Add price", "add_price"],
    ["  add   price to Services!! ", "add_price_to_services"],
    ["add-price", "add_price"],
    ["Ação nova", "a_o_nova"],
    ["x", "x"],
    ["v2", "v2"],
  ])("%j -> %j", (input, expected) => expect(slugifyName(input)).toBe(expected));

  it("cuts at 64 characters and does not leave a trailing underscore", () => {
    expect(slugifyName("a".repeat(100))).toBe("a".repeat(64));
    const cutOnSeparator = `${"a".repeat(63)} bbb`;
    expect(slugifyName(cutOnSeparator)).toBe("a".repeat(63));
  });

  it.each(["", "   ", "!!!", "___", "çãõ"])(
    "rejects %j with InvalidMigrationNameError",
    (input) => {
      const error = (() => {
        try {
          slugifyName(input);
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(InvalidMigrationNameError);
      expect((error as InvalidMigrationNameError).input).toBe(input);
    },
  );
});

describe("newMigrationId", () => {
  const now = new Date("2026-10-02T15:30:12.345Z");

  it("joins the UTC timestamp, the random suffix and the slugified name", () => {
    expect(newMigrationId("Add price", now, () => "1a2b")).toBe(
      "20261002T153012345Z_1a2b_add_price",
    );
  });

  it("always yields a valid id, with millisecond precision kept", () => {
    const id = newMigrationId("x", new Date("2026-01-02T03:04:05.006Z"), () => "00ff");
    expect(id).toBe("20260102T030405006Z_00ff_x");
    expect(MIGRATION_ID_PATTERN.test(id)).toBe(true);
  });

  it("rejects a random source that is not 4 lowercase hex digits", () => {
    for (const bad of ["xyz1", "1A2B", "12", "12345", ""]) {
      expect(() => newMigrationId("x", now, () => bad)).toThrow(TypeError);
    }
  });

  it("propagates an invalid name", () => {
    expect(() => newMigrationId("???", now, () => "1a2b")).toThrow(
      InvalidMigrationNameError,
    );
  });
});

describe("compareIds", () => {
  it("orders ids by creation time, then by suffix", () => {
    const early = newMigrationId("z", new Date("2026-01-01T00:00:00.000Z"), () => "ffff");
    const late = newMigrationId("a", new Date("2026-01-01T00:00:00.001Z"), () => "0000");
    expect(compareIds(early, late)).toBeLessThan(0);
    expect(compareIds(late, early)).toBeGreaterThan(0);
    expect(compareIds(early, early)).toBe(0);
  });

  it("sorts correctly across a year/millisecond boundary", () => {
    const ids = [
      "20270101T000000000Z_0000_a",
      "20261231T235959999Z_0000_a",
      "20261231T235959999Z_0000_9",
    ];
    expect(ids.toSorted(compareIds)).toEqual([
      "20261231T235959999Z_0000_9",
      "20261231T235959999Z_0000_a",
      "20270101T000000000Z_0000_a",
    ]);
  });
});
