import { all, keyedArray, nonEmpty, object, refine, required, unique, type Validator } from "@shuri/validate";
import type { Field, NumberField, SelectField, SelectOption } from "./fields.js";
import type { CollectionSchema } from "./types.js";

const numberFieldValidator: Validator<NumberField> = all(
  refine(
    (field) => field.min === undefined || field.max === undefined || field.min <= field.max,
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
    (field) => field.kind !== "integer" || field.min === undefined || Number.isInteger(field.min),
    '"min" must be an integer when kind is "integer"',
  ),
  refine(
    (field) => field.kind !== "integer" || field.max === undefined || Number.isInteger(field.max),
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
  ),
});

function relationFieldValidator(slugs: Set<string>): Validator<Extract<Field, { type: "relation" }>> {
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

function fieldValidator(slugs: Set<string>): Validator<Field> {
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

function fieldsValidator(slugs: Set<string>): Validator<Field[]> {
  return all(
    nonEmpty("must declare at least one field"),
    keyedArray((field) => field.name || "(missing name)", fieldValidator(slugs), {
      dedupeKey: (field) => field.name || undefined,
      duplicateMessage: (name) => `duplicate field name "${name}"`,
    }),
  );
}

function collectionValidator(slugs: Set<string>): Validator<CollectionSchema> {
  return object<CollectionSchema>({
    slug: required('"slug" is required'),
    title: required('"title" is required'),
    singular: required('"singular" is required'),
    plural: required('"plural" is required'),
    fields: fieldsValidator(slugs),
  });
}

/** Validates the shape of a collections schema, not the records it describes. */
export const collectionsValidator: Validator<CollectionSchema[]> = (collections, ctx) => {
  const slugs = new Set(collections.map((collection) => collection.slug));

  keyedArray((collection) => collection.slug || "(missing slug)", collectionValidator(slugs), {
    dedupeKey: (collection) => collection.slug || undefined,
    duplicateMessage: (slug) => `duplicate collection slug "${slug}"`,
  })(collections, ctx);
};
