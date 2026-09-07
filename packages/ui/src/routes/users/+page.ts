import { error } from "@sveltejs/kit";
import type { OrderBy, SortDirection } from "@shuri/store";
import { filterFields, readFilters, toWhere } from "$lib/lists/filters.js";
import { PAGE_SIZE } from "$lib/lists/paging.js";
import type { PageLoad } from "./$types.js";

/**
 * Loads one page of accounts, exactly as a collection's list loads records: same paging, same sort
 * in the URL, same filters — the users screens are generated from a collection schema like every
 * other screen, and the only thing that differs is the route the records come from.
 *
 * A 404 when the schema advertises no users block: the host's auth offers no user administration, so
 * there is no screen here rather than an empty one.
 * @param event - SvelteKit's load event: the query string and `parent()`.
 * @returns The users collection, its page of accounts, and the query they were read with.
 */
export const load: PageLoad = async (event) => {
  const { url, parent } = event;
  const { schema, client } = await parent();

  if (!schema.users) error(404, "Este admin não administra usuários");
  const collection = schema.users.collection;

  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const sort = url.searchParams.get("sort");
  const direction: SortDirection =
    url.searchParams.get("direction") === "desc" ? "desc" : "asc";
  const order: OrderBy | undefined = sort ? { field: sort, direction } : undefined;

  const filterable = filterFields(collection);
  const filters = readFilters(filterable, url.searchParams);
  const where = toWhere(filterable, filters);

  const records = await client.listUsers({
    limit: PAGE_SIZE + 1,
    offset,
    ...(where ? { where } : {}),
    ...(order ? { orderBy: [order] } : {}),
  });

  return {
    users: schema.users,
    collection,
    records: records.slice(0, PAGE_SIZE),
    hasMore: records.length > PAGE_SIZE,
    offset,
    order,
    filters,
  };
};
