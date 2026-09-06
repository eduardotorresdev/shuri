import { error } from "@sveltejs/kit";
import { loadRelationOptions } from "$lib/fields/relations.js";
import type { PageLoad } from "./$types.js";

/**
 * Loads a global's single record, alongside the options for any relation field it declares.
 * @param event - SvelteKit's load event: the route params and `parent()`.
 * @returns The global, its record, and its relation options.
 */
export const load: PageLoad = async (event) => {
  const { params, parent } = event;
  const { schema, client } = await parent();

  const global = schema.globals.find((candidate) => candidate.slug === params.slug);
  if (!global) error(404, `Global "${params.slug}" não existe`);

  const [record, relationOptions] = await Promise.all([
    client.getGlobal(global.slug),
    loadRelationOptions(client, schema, global.fields),
  ]);

  return { global, record, relationOptions };
};
