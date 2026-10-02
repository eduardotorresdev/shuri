import {
  arrayOf,
  assertValid,
  objectOf,
  oneOf,
  optional,
  string,
  type Validator,
} from "@shuri/validate";
import { DiffHintError } from "../errors.js";
import { compareCodePoints } from "../schema/canonical-json.js";
import type { TargetKind, TargetRef } from "./types.js";

/** Explicit rename hints: a rename is never inferred (decision D7). */
export interface RenameHints {
  entities?: { kind: TargetKind; from: string; to: string }[];
  /** `target.slug` is the NEW slug of the entity, so field hints compose with entity hints. */
  fields?: { target: TargetRef; from: string; to: string }[];
}

const unknownKey = (key: string) => `unknown property "${key}"`;
const nameOf = string("must be a string");
const options = { unknownKeyMessage: unknownKey };

const entityHint = objectOf<Record<string, unknown>>(
  {
    kind: oneOf<unknown>(["collection", "global"]),
    from: nameOf,
    to: nameOf,
  },
  "must be an object",
  options,
);

const fieldHint = objectOf<Record<string, unknown>>(
  {
    target: objectOf<Record<string, unknown>>(
      { kind: oneOf<unknown>(["collection", "global"]), slug: nameOf },
      "must be an object",
      options,
    ),
    from: nameOf,
    to: nameOf,
  },
  "must be an object",
  options,
);

/** The shape of `RenameHints`, for hints that come from outside the type system (a CLI, a config). */
export const renameHintsValidator: Validator<unknown> = objectOf<Record<string, unknown>>(
  {
    entities: optional(arrayOf(entityHint, "must be an array")),
    fields: optional(arrayOf(fieldHint, "must be an array")),
  },
  "must be an object",
  options,
);

/**
 * @param hints - Rename hints of unknown shape.
 * @throws {ValidationError} If they do not have the shape of `RenameHints`.
 */
export function assertRenameHints(hints: unknown): asserts hints is RenameHints {
  assertValid(hints, renameHintsValidator, "hints");
}

/** A rename, reduced to what validation and ordering need. */
export interface RenameItem<H> {
  hint: H;
  /** Namespace the names live in: an entity kind, or an entity key for fields. */
  scope: string;
  from: string;
  to: string;
}

export interface RenameSides {
  inPrev(scope: string, name: string): boolean;
  inNext(scope: string, name: string): boolean;
}

const slotOf = (scope: string, name: string) => `${scope}\u0000${name}`;

function describe(item: RenameItem<unknown>): string {
  return `${item.scope} ${item.from} -> ${item.to}`;
}

function checkDuplicates<H>(items: readonly RenameItem<H>[]): void {
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const item of items) {
    const source = slotOf(item.scope, item.from);
    const target = slotOf(item.scope, item.to);
    if (sources.has(source) || targets.has(target)) {
      throw new DiffHintError(
        item.hint,
        "duplicate",
        `${describe(item)} repeats a source or a destination`,
      );
    }
    sources.add(source);
    targets.add(target);
  }
}

// Follows from -> to links: a walk that comes back to its start is a cycle (swap, rotation, a -> a).
function checkCycles<H>(items: readonly RenameItem<H>[]): void {
  const next = new Map(items.map((item) => [slotOf(item.scope, item.from), item]));
  for (const start of items) {
    const origin = slotOf(start.scope, start.from);
    let current: RenameItem<H> | undefined = start;
    for (let steps = 0; current && steps <= items.length; steps += 1) {
      const destination = slotOf(current.scope, current.to);
      if (destination === origin) {
        throw new DiffHintError(
          start.hint,
          "cycle",
          `${describe(start)} is part of a rename cycle; break it with an intermediate name`,
        );
      }
      current = next.get(destination);
    }
  }
}

/**
 * Validates a set of renames of one kind. A name may be both the destination of one rename and the
 * source of another (a chain `b -> c`, `a -> b`): it then legitimately exists on both sides.
 * @param items - The renames.
 * @param sides - Where names exist before and after the change.
 * @throws {DiffHintError} On a duplicate, a cycle, or a source/destination that does not line up.
 */
export function validateRenames<H>(
  items: readonly RenameItem<H>[],
  sides: RenameSides,
): void {
  checkDuplicates(items);
  checkCycles(items);
  const freed = new Set(items.map((item) => slotOf(item.scope, item.from)));
  const claimed = new Set(items.map((item) => slotOf(item.scope, item.to)));
  for (const item of items) {
    const source = slotOf(item.scope, item.from);
    const target = slotOf(item.scope, item.to);
    if (!sides.inPrev(item.scope, item.from)) {
      throw new DiffHintError(
        item.hint,
        "source-missing",
        `${describe(item)}: no such source`,
      );
    }
    if (sides.inNext(item.scope, item.from) && !claimed.has(source)) {
      throw new DiffHintError(
        item.hint,
        "source-missing",
        `${describe(item)}: the source still exists in the new schema, so it was not renamed`,
      );
    }
    if (!sides.inNext(item.scope, item.to)) {
      throw new DiffHintError(
        item.hint,
        "target-missing",
        `${describe(item)}: the destination does not exist in the new schema`,
      );
    }
    if (sides.inPrev(item.scope, item.to) && !freed.has(target)) {
      throw new DiffHintError(
        item.hint,
        "target-missing",
        `${describe(item)}: the destination already exists in the old schema, so it is not new`,
      );
    }
  }
}

/**
 * Orders renames so that a rename into a name runs after the rename that vacates it.
 * Ties are broken by scope, then source name, so the result never depends on hint order.
 * @param items - Validated (acyclic, duplicate-free) renames.
 * @returns The same items in executable order.
 */
export function orderRenames<H>(items: readonly RenameItem<H>[]): RenameItem<H>[] {
  const pending = items.toSorted(
    (a, b) => compareCodePoints(a.scope, b.scope) || compareCodePoints(a.from, b.from),
  );
  const ordered: RenameItem<H>[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex(
      (item) =>
        !pending.some((other) => other.scope === item.scope && other.from === item.to),
    );
    // Validation rules out cycles, so a rename is always ready; fall back to the first for safety.
    ordered.push(...pending.splice(index === -1 ? 0 : index, 1));
  }
  return ordered;
}
