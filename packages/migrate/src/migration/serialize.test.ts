import { describe, expect, it } from "vitest";
import { add, col, int } from "../ops/test-support.js";
import { idAt, mig } from "./test-support.js";
import { parseMigration } from "./validator.js";
import { serializeMigration } from "./serialize.js";

const file = mig(idAt(1, "add_price"), null, [add(col("posts"), "price", int)]);

describe("serializeMigration", () => {
  it("writes two-space JSON ending in a newline, top-level keys in a fixed order", () => {
    const text = serializeMigration(file);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith('{\n  "format": 1,\n  "id": "')).toBe(true);
    const keys = [...text.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]);
    expect(keys).toEqual(["format", "id", "parent", "ops"]);
  });

  it("orders keys the same whatever the object's own order", () => {
    const shuffled = {
      ops: file.ops,
      parent: file.parent,
      id: file.id,
      format: file.format,
    } as typeof file;
    expect(serializeMigration(shuffled)).toBe(serializeMigration(file));
  });

  it("round-trips through parseMigration", () => {
    const source = `migrations/${file.id}.json`;
    expect(parseMigration(JSON.parse(serializeMigration(file)), source)).toEqual(file);
  });

  it("writes parent as null for the first migration and the id otherwise", () => {
    expect(serializeMigration(file)).toContain('"parent": null');
    const child = { ...file, parent: idAt(0, "root") };
    expect(serializeMigration(child)).toContain(`"parent": "${idAt(0, "root")}"`);
  });

  it("a rebase changes only the parent line", () => {
    const before = serializeMigration(file).split("\n");
    const after = serializeMigration({ ...file, parent: idAt(0, "root") }).split("\n");
    const changed = before.filter((line, i) => line !== after[i]);
    expect(before).toHaveLength(after.length);
    expect(changed).toEqual(['  "parent": null,']);
  });
});
