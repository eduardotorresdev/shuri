import { error } from "@sveltejs/kit";
import { loadRelationOptions } from "$lib/fields/relations.js";
import type { PageLoad } from "./$types.js";

/**
 * Prepares an empty form for the collection: its schema, plus the records every relation field can
 * point at.
 * @param event - SvelteKit's load event: the route params and `parent()`.
 * @returns The collection and its relation options.
 */
export const load: PageLoad = async (event) => {
  const { params, parent } = event;
  const { schema, client } = await parent();

  const collection = schema.collections.find(
    (candidate) => candidate.slug === params.slug,
  );
  if (!collection) error(404, `Coleção "${params.slug}" não existe`);

  return {
    collection,
    relationOptions: await loadRelationOptions(client, schema, collection.fields),
  };
};
