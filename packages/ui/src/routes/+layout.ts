import { base } from "$app/paths";
import { createAdminClient, fetchAdminSchema } from "$shared/index.js";
import type { LayoutLoad } from "./$types.js";

/**
 * No SSR and no prerendering: every screen is drawn from the schema the running app serves, so
 * there is nothing to render before that request has been made. This is also what makes
 * `adapter-static`'s single `index.html` correct for every route.
 */
export const ssr = false;
export const prerender = false;

/**
 * Loads the schema once for the whole admin and binds a client to it.
 *
 * In the root layout rather than per page because it is the same document for every screen, and
 * because the sidebar — rendered by the layout — is generated from it. Every child page reads both
 * off `parent()`, so a page load is one request for its own records and nothing else.
 * @param event - SvelteKit's load event, for its `fetch`.
 * @returns The schema and a client bound to it.
 */
export const load: LayoutLoad = async (event) => {
  const { fetch } = event;
  const schema = await fetchAdminSchema(base, { fetch });
  return { schema, client: createAdminClient(schema, { fetch }) };
};
