import { describe, expect, it } from "vitest";
import { idAt, mig } from "../migration/test-support.js";
import {
  add,
  alter,
  col,
  create,
  int,
  renameField,
  text,
  textarea,
} from "../ops/test-support.js";
import { replay } from "../ops/replay.js";
import { branchesCommute, type CommuteResult } from "./commute.js";
import { describeOp, formatConflict } from "./format-conflict.js";

const services = col("services");
const base = replay([{ ops: [create(services, { title: text })] }]);
const [a, b] = [idAt(1, "rename_title"), idAt(2, "alter_title")];

describe("formatConflict", () => {
  it("renders branches, the clashing resource with both ops, and the next command", () => {
    const result = branchesCommute(
      base,
      [mig(a, null, [renameField(services, "title", "name")])],
      [mig(b, null, [alter(services, "title", text, textarea)])],
    ) as Extract<CommuteResult, { commutes: false }>;
    expect(formatConflict(result, [[a], [b]])).toBe(
      [
        "conflict while reconciling",
        `  branch A: ${a}`,
        `  branch B: ${b}`,
        "  resource f:collection:services.title",
        "    A[0] renameField title→name in collection services",
        "    B[0] alterField title text→textarea in collection services",
        "  applying A then B fails: alterField: collection:services.title does not exist",
        "  edit one of the files and run `shuri-migrate reconcile`",
      ].join("\n"),
    );
  });

  it("qualifies op labels with the migration id when a branch has several migrations", () => {
    const result = branchesCommute(
      base,
      [
        mig(a, null, [add(services, "x", int)]),
        mig(idAt(3), a, [add(services, "price", int)]),
      ],
      [mig(b, null, [add(services, "price", text)])],
    ) as Extract<CommuteResult, { commutes: false }>;
    const output = formatConflict(result, [[a, idAt(3)], [b]]);
    expect(output).toContain(`  branch A: ${a}, ${idAt(3)}`);
    expect(output).toContain(
      `    A[${idAt(3)}#0] addField price number(integer) in collection services`,
    );
    expect(output).toContain("    B[0] addField price text in collection services");
  });

  it("explains a divergent result without a replay error", () => {
    const out = formatConflict({ commutes: false, reason: "divergent", conflicts: [] }, [
      [a],
      [b],
    ]);
    expect(out).toContain("different schemas (or lineages)");
  });
});

describe("describeOp", () => {
  it("describes relation, multiple and index details", () => {
    expect(
      describeOp(
        add(services, "tags", {
          type: "relation",
          collection: "tags",
          multiple: true,
          index: false,
        }),
      ),
    ).toBe("addField tags relation(tags)[] in collection services");
  });
});
