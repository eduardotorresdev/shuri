import type { FieldShape, FieldSpec } from "../schema/snapshot.js";
import type { MigrationId } from "../migration/types.js";
import type { MigrationOp, TargetRef } from "../ops/types.js";
import type { CommuteResult, OpConflict, OpRef } from "./commute.js";

function describeShape(spec: FieldShape | FieldSpec): string {
  const kind = spec.type === "number" ? `(${spec.kind})` : "";
  const target = spec.type === "relation" ? `(${spec.collection})` : "";
  const many = "multiple" in spec && spec.multiple ? "[]" : "";
  return `${spec.type}${kind}${target}${many}`;
}

const nameOf = (target: TargetRef): string => `${target.kind} ${target.slug}`;

/**
 * @param op - A migration op.
 * @returns A one-line description for diagnostics, e.g. `alterField title text→textarea`.
 */
export function describeOp(op: MigrationOp): string {
  switch (op.op) {
    case "createEntity":
      return `createEntity ${nameOf(op.target)} (${Object.keys(op.fields).join(", ")})`;
    case "dropEntity":
      return `dropEntity ${nameOf(op.target)}`;
    case "renameEntity":
      return `renameEntity ${nameOf(op.target)}→${op.to}`;
    case "addField":
      return `addField ${op.name} ${describeShape(op.spec)} in ${nameOf(op.target)}`;
    case "dropField":
      return `dropField ${op.name} in ${nameOf(op.target)}`;
    case "renameField":
      return `renameField ${op.from}→${op.to} in ${nameOf(op.target)}`;
    case "alterField":
      return `alterField ${op.name} ${describeShape(op.from)}→${describeShape(op.to)} in ${nameOf(op.target)}`;
    case "setIndex":
      return `setIndex ${op.name}=${op.index} in ${nameOf(op.target)}`;
  }
}

function labelOf(side: "A" | "B", ref: OpRef, branch: readonly MigrationId[]): string {
  const where = branch.length > 1 ? `${ref.migration}#${ref.index}` : String(ref.index);
  return `${side}[${where}] ${describeOp(ref.op)}`;
}

function uniqueRefs(refs: readonly OpRef[]): OpRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.migration}#${ref.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Renders the diagnostic of a reconcile conflict: the two branches, per clashing resource the ops
 * of each side, and the way out.
 * @param result - Why the branches do not commute.
 * @param branches - Ids of branch A and branch B.
 * @returns The multi-line text (no trailing newline).
 */
export function formatConflict(
  result: Extract<CommuteResult, { commutes: false }>,
  branches: readonly [readonly MigrationId[], readonly MigrationId[]],
): string {
  const lines = [
    "conflict while reconciling",
    `  branch A: ${branches[0].join(", ")}`,
    `  branch B: ${branches[1].join(", ")}`,
  ];
  const byResource = new Map<string, OpConflict[]>();
  for (const conflict of result.conflicts) {
    byResource.set(conflict.resource, [
      ...(byResource.get(conflict.resource) ?? []),
      conflict,
    ]);
  }
  for (const [resource, conflicts] of byResource) {
    lines.push(`  resource ${resource}`);
    for (const ref of uniqueRefs(conflicts.map((c) => c.a))) {
      lines.push(`    ${labelOf("A", ref, branches[0])}`);
    }
    for (const ref of uniqueRefs(conflicts.map((c) => c.b))) {
      lines.push(`    ${labelOf("B", ref, branches[1])}`);
    }
  }
  lines.push(
    result.reason === "replay-error"
      ? `  applying ${result.order === "AB" ? "A then B" : "B then A"} fails: ${result.error.message}`
      : "  the branches end in different schemas (or lineages) depending on the order they run in",
    "  edit one of the files and run `shuri-migrate reconcile`",
  );
  return lines.join("\n");
}
