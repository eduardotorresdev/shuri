import { CanonicalJsonError } from "../errors.js";

/**
 * Compares two strings by Unicode code point. `Array.prototype.sort`'s default compares UTF-16 code
 * units, which orders an astral character (a surrogate pair) before U+E000..U+FFFF.
 * @param a - Left string.
 * @param b - Right string.
 * @returns Negative, zero or positive, like a sort comparator.
 */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    if (ca !== cb) return ca - cb;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  return a.length - i - (b.length - j);
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function encode(value: unknown, path: string, ancestors: Set<object>): string {
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value))
        throw new CanonicalJsonError(path, `${value} is not JSON`);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(path, `a ${typeof value} is not JSON`);
  }
  if (value === null) return "null";
  if (ancestors.has(value)) throw new CanonicalJsonError(path, "circular reference");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.map((item, index) => {
        if (item === undefined) {
          throw new CanonicalJsonError(`${path}[${index}]`, "undefined inside an array");
        }
        return encode(item, `${path}[${index}]`, ancestors);
      });
      return `[${items.join(",")}]`;
    }
    if (!isPlain(value)) {
      throw new CanonicalJsonError(path, "only plain objects and arrays are supported");
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => compareCodePoints(a, b))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${encode(item, `${path}.${key}`, ancestors)}`,
      );
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Deterministic JSON: object keys sorted by code point, no whitespace, `undefined` properties
 * omitted. Two structurally equal values always serialize to the same string, which is what makes it
 * usable as an equality key and as checksum input.
 * @param value - Plain data: objects, arrays, strings, finite numbers, booleans and null.
 * @returns The canonical JSON text.
 * @throws {CanonicalJsonError} For `undefined` in an array or at the top level, NaN/Infinity,
 *   non-plain objects (Date, Map, class instances), functions, symbols, bigints and cycles.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new CanonicalJsonError("$", "undefined is not JSON");
  return encode(value, "$", new Set());
}

export { CanonicalJsonError };
