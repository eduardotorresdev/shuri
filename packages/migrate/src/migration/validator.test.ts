import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import { MigrationFileError } from "../errors.js";
import { add, col, create, dropEntity, int, text } from "../ops/test-support.js";
import { idAt, mig } from "./test-support.js";
import { migrationFileValidator, parseMigration } from "./validator.js";

const id = idAt(1, "init");
const valid = (): Record<string, unknown> => ({
  format: 1,
  id,
  parent: null,
  ops: [create(col("posts"), { title: text })],
});
const issuesOf = (value: unknown) =>
  validate(value, migrationFileValidator).map((i) => `${i.path}: ${i.message}`);

describe("migrationFileValidator", () => {
  it("accepts a well-formed file with a null or an id parent", () => {
    expect(issuesOf(valid())).toEqual([]);
    expect(issuesOf({ ...valid(), parent: idAt(0, "root") })).toEqual([]);
  });

  it.each([
    ["a non-object", "x", ": must be an object"],
    ["an array", [], ": must be an object"],
    ["a wrong format", { ...valid(), format: 2 }, "format: must be one of 1"],
    [
      "a malformed id",
      { ...valid(), id: "init" },
      `id: must match ${/^\d{8}T\d{9}Z_[0-9a-f]{4}_[a-z0-9_]{1,64}$/}`,
    ],
    ["a non-string id", { ...valid(), id: 3 }, "id: must be a string"],
    [
      "an undefined parent",
      { ...valid(), parent: undefined },
      "parent: must be a string",
    ],
    [
      "a malformed parent",
      { ...valid(), parent: "x" },
      `parent: must match ${/^\d{8}T\d{9}Z_[0-9a-f]{4}_[a-z0-9_]{1,64}$/}`,
    ],
    ["no ops", { ...valid(), ops: [] }, "ops: must have at least one op"],
    ["ops not an array", { ...valid(), ops: {} }, "ops: must be an array"],
    ["an unknown key", { ...valid(), extra: 1 }, 'extra: unknown property "extra"'],
    [
      "an unknown op",
      { ...valid(), ops: [{ op: "nope" }] },
      'ops.0.op: unknown op "nope"; must be one of createEntity, dropEntity, renameEntity, addField, dropField, renameField, alterField, setIndex',
    ],
  ])("rejects %s", (_label, value, expected) => {
    expect(issuesOf(value)).toContain(expected);
  });

  it("reports an invalid op at its position, with the op's own path", () => {
    const bad = {
      ...valid(),
      ops: [
        dropEntity(col("a")),
        {
          op: "addField",
          target: { kind: "collection", slug: "posts" },
          name: "id",
          spec: { type: "text", index: false },
        },
      ],
    };
    expect(issuesOf(bad)).toEqual(['ops.1.name: "id" is reserved']);
  });

  it("reports every problem at once", () => {
    const bad = { format: 9, id: "x", parent: 1, ops: [] };
    expect(issuesOf(bad)).toHaveLength(4);
  });
});

describe("parseMigration", () => {
  it("returns the typed file when the id equals the file name", () => {
    const json = valid();
    expect(parseMigration(json, `migrations/${id}.json`)).toEqual(json);
    expect(parseMigration(json, `C:\\app\\migrations\\${id}.json`)).toEqual(json);
    expect(parseMigration(json, `${id}.json`)).toEqual(json);
  });

  it("throws MigrationFileError with the source and the issues for invalid content", () => {
    const source = `migrations/${id}.json`;
    const error = (() => {
      try {
        parseMigration({ ...valid(), ops: [] }, source);
      } catch (e) {
        return e;
      }
    })() as MigrationFileError;
    expect(error).toBeInstanceOf(MigrationFileError);
    expect(error.name).toBe("MigrationFileError");
    expect(error.source).toBe(source);
    expect(error.issues).toEqual([{ path: "ops", message: "must have at least one op" }]);
    expect(error.message).toContain(source);
    expect(error.message).toContain("must have at least one op");
  });

  it("rejects an id that differs from the file name", () => {
    const other = idAt(2, "other");
    expect(() => parseMigration(valid(), `migrations/${other}.json`)).toThrowError(
      new RegExp(`id: must equal the file name "${other}"`),
    );
  });

  it("does not report a file-name mismatch on top of structural issues", () => {
    expect(() =>
      parseMigration({ ...valid(), ops: [] }, "migrations/other.json"),
    ).toThrowError(/^(?!.*file name)/s);
  });

  it("accepts what the builders produce", () => {
    const file = mig(id, null, [add(col("posts"), "n", int)]);
    expect(parseMigration(file, `${id}.json`)).toBe(file);
  });
});
