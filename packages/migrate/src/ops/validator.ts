import {
  all,
  boolean,
  discriminated,
  objectOf,
  oneOf,
  record,
  type Validator,
} from "@shuri/validate";
import {
  fieldNameValidator,
  fieldShapeValidator,
  fieldSpecValidator,
  slugValidator,
  unknownKey,
} from "../schema/validator.js";
import { structurallyEqual } from "../schema/snapshot.js";
import { OP_NAMES } from "./types.js";

const MSG = "must be an object";

const targetValidator: Validator<unknown> = objectOf<Record<string, unknown>>(
  { kind: oneOf<unknown>(["collection", "global"]), slug: slugValidator },
  MSG,
  { unknownKeyMessage: unknownKey },
);

const noop: Validator<unknown> = () => undefined;

function opOf(fields: Record<string, Validator<unknown>>): Validator<unknown> {
  return objectOf<Record<string, unknown>>(
    { op: noop, target: targetValidator, ...fields },
    MSG,
    { unknownKeyMessage: unknownKey },
  );
}

type Loose = Record<string, unknown>;

// Reports at `at` when `equal` holds for an object value; non-objects are left to the other validators.
function distinctFrom(
  at: string,
  equal: (op: Loose) => boolean,
  message: string,
): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value === "object" && value !== null && equal(value as Loose)) {
      ctx.at(at).addIssue(message);
    }
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return structurallyEqual(a, b);
  } catch {
    return false; // not JSON at all: the nested validators report it
  }
}

/** Validates a single op read from a migration file. Names are checked against the name grammar. */
export const migrationOpValidator: Validator<unknown> = discriminated(
  "op",
  {
    createEntity: opOf({
      fields: record(fieldSpecValidator, MSG, { key: fieldNameValidator }),
    }),
    dropEntity: opOf({}),
    renameEntity: all(
      opOf({ to: slugValidator }),
      distinctFrom(
        "to",
        (op) => (op.target as Loose | undefined)?.slug === op.to,
        "must differ from the current slug",
      ),
    ),
    addField: opOf({ name: fieldNameValidator, spec: fieldSpecValidator }),
    dropField: opOf({ name: fieldNameValidator }),
    renameField: all(
      opOf({ from: fieldNameValidator, to: fieldNameValidator }),
      distinctFrom("to", (op) => op.from === op.to, "must differ from `from`"),
    ),
    alterField: all(
      opOf({
        name: fieldNameValidator,
        from: fieldShapeValidator,
        to: fieldShapeValidator,
      }),
      distinctFrom("to", (op) => sameJson(op.from, op.to), "must differ from `from`"),
    ),
    setIndex: opOf({
      name: fieldNameValidator,
      index: boolean('"index" must be a boolean'),
    }),
  },
  (tag) => `unknown op ${JSON.stringify(tag)}; must be one of ${OP_NAMES.join(", ")}`,
);
