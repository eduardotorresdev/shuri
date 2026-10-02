import { structurallyEqual, type FieldShape } from "../schema/snapshot.js";
import type { MigrationOp } from "./types.js";

/**
 * - `identical`: nothing to convert.
 * - `lossless`: every valid source value maps to a valid target value without losing information.
 * - `lossy`: some values are truncated, cleared or reinterpreted.
 */
export type Conversion = "identical" | "lossless" | "lossy";

const TEXTUAL = new Set(["text", "textarea"]);

function isMultiple(shape: FieldShape): boolean {
  return "multiple" in shape && shape.multiple;
}

function multiplicityConversion(from: FieldShape, to: FieldShape): Conversion {
  return isMultiple(from) && !isMultiple(to) ? "lossy" : "lossless";
}

/**
 * Classifies a change of field shape. This is the specification the drivers implement (see
 * `convertValue` for the per-value rule): memory through `convertValue`, a document store through a guarded
 * pipeline, a SQL driver through CASE/CAST.
 * @param from - The shape before.
 * @param to - The shape after.
 * @returns How safe the conversion is for existing data.
 */
export function conversionOf(from: FieldShape, to: FieldShape): Conversion {
  if (structurallyEqual(from, to)) return "identical";

  if (from.type === to.type) {
    if (from.type === "number" && to.type === "number") {
      return from.kind === "integer" && to.kind === "float" ? "lossless" : "lossy";
    }
    if (from.type === "relation" && to.type === "relation") {
      return from.collection === to.collection
        ? multiplicityConversion(from, to)
        : "lossy";
    }
    return multiplicityConversion(from, to);
  }

  if (TEXTUAL.has(from.type) && TEXTUAL.has(to.type)) return "lossless";
  if (from.type === "email" && TEXTUAL.has(to.type)) return "lossless";
  if (TEXTUAL.has(from.type) && to.type === "email") return "lossy";
  if ((from.type === "number" || from.type === "boolean") && TEXTUAL.has(to.type)) {
    return "lossless";
  }
  if (from.type === "select" && !from.multiple && TEXTUAL.has(to.type)) return "lossless";
  return "lossy";
}

/**
 * @param op - A migration op.
 * @returns Whether applying it can destroy data: dropping an entity or field, or a lossy `alterField`.
 */
export function isDestructive(op: MigrationOp): boolean {
  switch (op.op) {
    case "dropEntity":
    case "dropField":
      return true;
    case "alterField":
      return conversionOf(op.from, op.to) === "lossy";
    default:
      return false;
  }
}
