import { describe, expect, it } from "vitest";
import { MigrationFileError } from "../errors.js";
import { parseBundle } from "./bundle.js";
import { idAt, mig } from "./test-support.js";

const a = mig(idAt(1, "init"), null);
const b = mig(idAt(2, "next"), a.id);

describe("parseBundle", () => {
  it("returns the migrations in the order given, as the typed files", () => {
    // What a JSON import looks like at runtime: plain data, not typed as a MigrationFile.
    const imported: unknown[] = JSON.parse(JSON.stringify([a, b]));
    expect(parseBundle(imported)).toEqual([a, b]);
  });

  it("accepts an empty bundle", () => {
    expect(parseBundle([])).toEqual([]);
  });

  it("rejects an entry that is not a valid migration, naming it by its id", () => {
    const error = (() => {
      try {
        parseBundle([a, { ...b, format: 2 }]);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(MigrationFileError);
    expect((error as MigrationFileError).source).toBe(`${b.id}.json`);
  });

  it("names an entry without an id by its position", () => {
    expect(() => parseBundle([a, null])).toThrow(/bundle\[1\]/);
  });
});
