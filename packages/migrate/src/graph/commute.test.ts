import { describe, expect, it } from "vitest";
import { idAt, mig } from "../migration/test-support.js";
import {
  add,
  alter,
  col,
  create,
  dropEntity,
  dropField,
  int,
  renameField,
  text,
  textarea,
} from "../ops/test-support.js";
import { replay } from "../ops/replay.js";
import { branchesCommute, type CommuteResult } from "./commute.js";

const services = col("services");
const base = replay([{ ops: [create(services, { title: text })] }]);
const [a1, a2, b1] = [1, 2, 3].map((n) => idAt(n));

type Failure = Extract<CommuteResult, { commutes: false }>;
const failure = (r: CommuteResult): Failure => {
  if (r.commutes) throw new Error("expected a conflict");
  return r;
};

describe("branchesCommute", () => {
  it("commutes when the branches touch different fields", () => {
    const result = branchesCommute(
      base,
      [mig(a1, null, [add(services, "price", int)])],
      [mig(b1, null, [add(services, "stock", int)])],
    );
    expect(result).toEqual({ commutes: true });
  });

  it("commutes when both branches add the same field identically (same lineage)", () => {
    const same = [add(services, "price", int)];
    expect(branchesCommute(base, [mig(a1, null, same)], [mig(b1, null, same)])).toEqual({
      commutes: true,
    });
  });

  it("replays whole branches, so a conflict between later migrations is found", () => {
    const result = failure(
      branchesCommute(
        base,
        [
          mig(a1, null, [add(services, "x", int)]),
          mig(a2, a1, [renameField(services, "title", "name")]),
        ],
        [mig(b1, null, [alter(services, "title", text, textarea)])],
      ),
    );
    expect(result.reason).toBe("replay-error");
    expect(
      result.conflicts.map((c) => [c.a.migration, c.b.migration, c.resource]),
    ).toEqual([[a2, b1, "f:collection:services.title"]]);
  });

  it("reports the failing order and the replay error (AB first)", () => {
    const result = failure(
      branchesCommute(
        base,
        [mig(a1, null, [renameField(services, "title", "name")])],
        [mig(b1, null, [alter(services, "title", text, textarea)])],
      ),
    );
    if (result.reason !== "replay-error") throw new Error("expected replay-error");
    expect(result.order).toBe("AB");
    expect(result.error.reason).toBe("field-missing");
  });

  it("reports order BA when only b-then-a fails", () => {
    // a adds a field, b drops the entity: a-then-b is fine, b-then-a adds to a missing entity.
    const result = failure(
      branchesCommute(
        base,
        [mig(a1, null, [add(services, "price", int)])],
        [mig(b1, null, [dropEntity(services)])],
      ),
    );
    if (result.reason !== "replay-error") throw new Error("expected replay-error");
    expect(result.order).toBe("BA");
    expect(result.error.reason).toBe("entity-missing");
  });

  it("is divergent (not an error) when both orders replay but end differently", () => {
    // rename a->b vs drop a + add b: both orders are valid, lineages differ.
    const withA = replay([{ ops: [create(services, { a: text })] }]);
    const result = failure(
      branchesCommute(
        withA,
        [mig(a1, null, [renameField(services, "a", "b")])],
        [mig(b1, null, [dropField(services, "a"), add(services, "b", text)])],
      ),
    );
    expect(result.reason).toBe("divergent");
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(new Set(result.conflicts.map((c) => c.resource))).toContain(
      "f:collection:services.a",
    );
  });

  it("labels conflicts only with pairs whose footprints collide", () => {
    const result = failure(
      branchesCommute(
        base,
        [mig(a1, null, [add(services, "price", int), add(services, "other", int)])],
        [mig(b1, null, [add(services, "price", text)])],
      ),
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      a: { migration: a1, index: 0 },
      b: { migration: b1, index: 0 },
      resource: "f:collection:services.price",
    });
  });

  it("rethrows errors that are not replay errors", () => {
    const broken = { ...mig(a1, null), ops: null as never };
    expect(() => branchesCommute(base, [broken], [])).toThrow(TypeError);
  });
});
