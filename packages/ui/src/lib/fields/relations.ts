import type { Field } from "@shuri/core";
import type { AdminClient, AdminSchema } from "$shared/index.js";
import { recordLabel, type RelationLabels } from "./values.js";

/** One choice in a relation control: the referenced record's id, and the text standing in for it. */
export interface RelationOption {
  value: string;
  label: string;
}

/** The options available to each relation field of a form, keyed by the collection it references. */
export type RelationOptions = Record<string, readonly RelationOption[]>;

/** How many records a relation control offers before the author has to narrow the list some other way. */
const OPTION_LIMIT = 200;

/**
 * Loads the choices for every relation field among `fields`, one request per referenced collection.
 *
 * Grouped by collection rather than by field, so a form with three fields pointing at `authors`
 * fetches `authors` once. Records are capped at `OPTION_LIMIT` and labelled through the referenced
 * collection's own `labelField`, which is what makes a `<select>` of relations readable without any
 * per-collection configuration.
 *
 * A collection the admin doesn't serve — one declared `internal` — is skipped rather than requested:
 * it is absent from the schema by design, and asking for it would 404.
 * @param client - The client to read records through.
 * @param schema - The admin schema, for resolving each referenced collection.
 * @param fields - The fields of the form being rendered.
 * @returns The options for each referenced collection.
 */
export async function loadRelationOptions(
  client: AdminClient,
  schema: AdminSchema,
  fields: readonly Field[],
): Promise<RelationOptions> {
  const slugs = new Set(
    fields.filter((field) => field.type === "relation").map((field) => field.collection),
  );

  const entries = await Promise.all(
    [...slugs].map(async (slug) => {
      const collection = schema.collections.find((candidate) => candidate.slug === slug);
      if (!collection) return [slug, []] as const;

      const records = await client.list(slug, { limit: OPTION_LIMIT });
      const options = records.map((record) => ({
        value: record.id,
        label: recordLabel(collection, record),
      }));
      return [slug, options] as const;
    }),
  );

  return Object.fromEntries(entries);
}

/**
 * Turns relation options into the `id -> label` lookup a table cell needs. A list is what a
 * `<select>` renders; a map is what a row of ids is resolved through, once per page rather than
 * once per cell.
 * @param options - The options loaded for the page.
 * @returns The same records, keyed by id.
 */
export function relationLabels(options: RelationOptions): RelationLabels {
  return Object.fromEntries(
    Object.entries(options).map(([slug, entries]) => [
      slug,
      Object.fromEntries(entries.map((entry) => [entry.value, entry.label])),
    ]),
  );
}
