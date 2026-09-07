import { error } from "@sveltejs/kit";
import { AdminRequestError } from "$shared/index.js";
import type { PageLoad } from "./$types.js";

/**
 * Loads one account. A 404 from the route is re-thrown as SvelteKit's own, so a deleted user shows
 * the error page rather than an empty form that would save into nothing.
 * @param event - SvelteKit's load event: the route params and `parent()`.
 * @returns The users block and the account being edited.
 */
export const load: PageLoad = async (event) => {
  const { params, parent } = event;
  const { schema, client } = await parent();

  if (!schema.users) error(404, "Este admin não administra usuários");

  const user = await client.getUser(params.id).catch((caught: unknown) => {
    if (caught instanceof AdminRequestError) error(caught.status, caught.message);
    throw caught;
  });

  return { users: schema.users, user };
};
