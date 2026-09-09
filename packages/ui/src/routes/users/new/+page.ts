import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types.js";

/**
 * Prepares an empty account form.
 * @param event - SvelteKit's load event, for `parent()`.
 * @returns The users block the form is generated from.
 */
export const load: PageLoad = async (event) => {
  const { schema } = await event.parent();
  if (!schema.users) error(404, "Este admin não administra usuários");
  return { users: schema.users };
};
