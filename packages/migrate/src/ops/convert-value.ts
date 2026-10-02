import { email, validate } from "@shuri/validate";
import { structurallyEqual, type FieldShape } from "../schema/snapshot.js";

/** Plain decimals only: no exponent, hex, whitespace or `+`. Expressible as a regex in every engine. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

const TEXTUAL = new Set(["text", "textarea"]);

const isEmail = (value: string): boolean => validate(value, email()).length === 0;

const isMultiple = (shape: FieldShape): boolean => "multiple" in shape && shape.multiple;

// Normalises `-0` to `0` so that equal conversions compare equal.
const clean = (n: number): number => n + 0;

function toNumber(value: string, integer: boolean): number | undefined {
  if (!DECIMAL.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (integer && !Number.isInteger(parsed)) return undefined;
  return clean(parsed);
}

function toSingle(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const [first] = value as unknown[];
  return Array.isArray(first) ? undefined : first;
}

function toMultiple(value: unknown): unknown {
  return Array.isArray(value) ? value : [value];
}

function convertMultiplicity(value: unknown, from: FieldShape, to: FieldShape): unknown {
  if (isMultiple(from) === isMultiple(to)) return value;
  return isMultiple(to) ? toMultiple(value) : toSingle(value);
}

function convertTyped(value: unknown, from: FieldShape, to: FieldShape): unknown {
  if (from.type === to.type) {
    if (from.type === "number" && to.type === "number") {
      return typeof value === "number" && Number.isFinite(value) && to.kind === "integer"
        ? clean(Math.trunc(value))
        : value;
    }
    return convertMultiplicity(value, from, to);
  }

  const fromText = TEXTUAL.has(from.type);
  const toText = TEXTUAL.has(to.type);
  if ((fromText || from.type === "email") && toText) return value;
  if (fromText && to.type === "email") {
    return typeof value === "string" && !isEmail(value) ? undefined : value;
  }
  if ((from.type === "number" || from.type === "boolean") && toText) {
    if (typeof value === "number") return String(clean(value));
    return typeof value === "boolean" ? String(value) : value;
  }
  if (fromText && to.type === "number") {
    return typeof value === "string" ? toNumber(value, to.kind === "integer") : value;
  }
  if (fromText && to.type === "boolean") {
    if (typeof value !== "string") return value;
    return value === "true" ? true : value === "false" ? false : undefined;
  }
  if (from.type === "select" && !from.multiple && toText) return value;
  if (fromText && to.type === "select" && !to.multiple) return value;
  return undefined;
}

/**
 * Converts one stored value from one field shape to another. The rule for every pair of shapes is
 * the matrix in the migrate plan (section 4.4); `conversionOf` classifies it.
 *
 * Properties every driver relies on: **deterministic**, and **idempotent**
 * (`convert(convert(v)) == convert(v)`), because a driver that crashed halfway re-runs the whole
 * conversion over rows that were already converted. Idempotence is achieved by converting only
 * values of the source type and leaving values already of the target type untouched.
 * @param value - The stored value. `undefined` and `null` mean "no value" and pass through.
 * @param from - The shape the value has now.
 * @param to - The shape it must have.
 * @returns The converted value; `undefined` means "remove the key".
 */
export function convertValue(value: unknown, from: FieldShape, to: FieldShape): unknown {
  if (value === undefined || value === null) return value;
  if (structurallyEqual(from, to)) return value;
  return convertTyped(value, from, to);
}
