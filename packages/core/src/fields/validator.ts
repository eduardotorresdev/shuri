import {
  all,
  keyedArray,
  nonEmpty,
  object,
  refine,
  required,
  unique,
  type Validator,
} from "@shuri/validate";
import type {
  Field,
  NumberField,
  SelectField,
  SelectOption,
} from "../collections/fields.js";

const numberFieldValidator: Validator<NumberField> = all(
  refine(
    (field) =>
      field.min === undefined || field.max === undefined || field.min <= field.max,
    (field) => `"min" (${field.min}) cannot be greater than "max" (${field.max})`,
  ),
  refine(
    (field) => field.sign !== "positive" || field.min === undefined || field.min >= 0,
    '"min" cannot be negative when sign is "positive"',
  ),
  refine(
    (field) => field.sign !== "negative" || field.max === undefined || field.max <= 0,
    '"max" cannot be positive when sign is "negative"',
  ),
  refine(
    (field) =>
      field.kind !== "integer" || field.min === undefined || Number.isInteger(field.min),
    '"min" must be an integer when kind is "integer"',
  ),
  refine(
    (field) =>
      field.kind !== "integer" || field.max === undefined || Number.isInteger(field.max),
    '"max" must be an integer when kind is "integer"',
  ),
);

const selectFieldValidator: Validator<SelectField> = object<SelectField>({
  options: all(
    nonEmpty("must declare at least one option"),
    unique<SelectOption>(
      (option) => option.value,
      (value) => `duplicate option value "${value}"`,
    ),
  ) as Validator<readonly SelectOption[]>,
});

function relationFieldValidator(
  slugs: Set<string>,
): Validator<Extract<Field, { type: "relation" }>> {
  return object({
    collection: all<string>(
      required('"collection" is required'),
      refine(
        (collection) => collection === "" || slugs.has(collection),
        (collection) => `references unknown collection "${collection}"`,
      ),
    ),
  });
}

/**
 * Validates a single declared field's own shape (name, plus its type-specific constraints), not the
 * records it describes. Shared by collections and globals, whose fields are validated identically.
 * @param slugs - The collection slugs relation fields may reference.
 * @returns A validator for a single declared field.
 */
export function fieldValidator(slugs: Set<string>): Validator<Field> {
  return all<Field>(
    object<Field>({ name: required('"name" is required') }),
    (field, ctx) => {
      switch (field.type) {
        case "select":
          selectFieldValidator(field, ctx);
          break;
        case "number":
          numberFieldValidator(field, ctx);
          break;
        case "relation":
          relationFieldValidator(slugs)(field, ctx);
          break;
        default:
          break;
      }
    },
  );
}

/**
 * Validates a declared `fields` array: at least one field, no duplicate names, each field's own shape.
 * @param slugs - The collection slugs relation fields may reference.
 * @returns A validator for a declared `fields` array.
 */
export function fieldsValidator(slugs: Set<string>): Validator<readonly Field[]> {
  return all(
    nonEmpty("must declare at least one field"),
    keyedArray((field) => field.name || "(missing name)", fieldValidator(slugs), {
      dedupeKey: (field) => field.name || undefined,
      duplicateMessage: (name) => `duplicate field name "${name}"`,
    }),
  ) as Validator<readonly Field[]>;
}
