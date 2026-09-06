import { error } from "@sveltejs/kit";
import { AdminRequestError } from "$shared/index.js";
import { loadRelationOptions } from "$lib/fields/relations.js";
import type { PageLoad } from "./$types.js";

/**
 * Loads one record and the options for its relation fields.
 *
 * A 404 from the store is re-thrown as SvelteKit's own, so a deleted record shows the error page
 * rather than an empty form that would silently re-create it on save.
 * @param event - SvelteKit's load event: the route params and `parent()`.
 * @returns The collection, the record, and its relation options.
 */
export const load: PageLoad = async (event) => {
  const { params, parent } = event;
  const { schema, client } = await parent();

  const collection = schema.collections.find(
    (candidate) => candidate.slug === params.slug,
  );
  if (!collection) error(404, `Coleção "${params.slug}" não existe`);

  const [record, relationOptions] = await Promise.all([
    client.get(collection.slug, params.id).catch((caught: unknown) => {
      if (caught instanceof AdminRequestError) error(caught.status, caught.message);
      throw caught;
    }),
    loadRelationOptions(client, schema, collection.fields),
  ]);

  return { collection, record, relationOptions };
};
