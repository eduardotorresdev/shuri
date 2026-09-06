import { error } from "@sveltejs/kit";
import type { OrderBy, SortDirection } from "@shuri/store";
import { loadRelationOptions, relationLabels } from "$lib/fields/relations.js";
import { listColumns } from "$lib/lists/columns.js";
import type { PageLoad } from "./$types.js";

/** Records per page. */
export const PAGE_SIZE = 25;

/**
 * Loads one page of a collection's records.
 *
 * Asks for `PAGE_SIZE + 1` and shows `PAGE_SIZE`: the REST list route answers with records and no
 * total, so the extra record is how the pager learns a next page exists without a second `count`
 * round trip.
 *
 * Sort and page live in the URL rather than in component state, so a sorted list is a link that can
 * be shared, bookmarked, and returned to with the browser's back button after editing a record.
 *
 * Relation columns are resolved to names alongside the page — one request per referenced collection
 * for the whole table, not one per row.
 * @param event - SvelteKit's load event: the route params, the query string, and `parent()`.
 * @returns The collection, its page of records, and the query the page was read with.
 */
export const load: PageLoad = async (event) => {
  const { params, url, parent } = event;
  const { schema, client } = await parent();

  const collection = schema.collections.find(
    (candidate) => candidate.slug === params.slug,
  );
  if (!collection) error(404, `Coleção "${params.slug}" não existe`);

  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const sort = url.searchParams.get("sort");
  const direction: SortDirection =
    url.searchParams.get("direction") === "desc" ? "desc" : "asc";
  const order: OrderBy | undefined = sort ? { field: sort, direction } : undefined;

  const [records, relations] = await Promise.all([
    client.list(collection.slug, {
      limit: PAGE_SIZE + 1,
      offset,
      ...(order ? { orderBy: [order] } : {}),
    }),
    loadRelationOptions(client, schema, listColumns(collection)),
  ]);

  return {
    collection,
    records: records.slice(0, PAGE_SIZE),
    relationLabels: relationLabels(relations),
    hasMore: records.length > PAGE_SIZE,
    offset,
    order,
  };
};
