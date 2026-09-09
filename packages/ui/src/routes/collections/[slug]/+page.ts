import { error } from "@sveltejs/kit";
import type { OrderBy, SortDirection } from "@shuri/store";
import { loadRelationOptions, relationLabels } from "$lib/fields/relations.js";
import { listColumns } from "$lib/lists/columns.js";
import { filterFields, readFilters, toWhere } from "$lib/lists/filters.js";
import { PAGE_SIZE } from "$lib/lists/paging.js";
import type { PageLoad } from "./$types.js";

export { PAGE_SIZE };

/**
 * Loads one page of a collection's records.
 *
 * Asks for `PAGE_SIZE + 1` and shows `PAGE_SIZE`: the REST list route answers with records and no
 * total, so the extra record is how the pager learns a next page exists without a second `count`
 * round trip.
 *
 * Sort, filters and page live in the URL rather than in component state, so a narrowed list is a
 * link that can be shared, bookmarked, and returned to with the browser's back button after editing
 * a record.
 *
 * Relations are resolved to names alongside the page — one request per referenced collection for
 * the whole table and its filter panel, not one per row.
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

  const filterable = filterFields(collection);
  const filters = readFilters(filterable, url.searchParams);
  const where = toWhere(filterable, filters);

  const [records, relations] = await Promise.all([
    client.list(collection.slug, {
      limit: PAGE_SIZE + 1,
      offset,
      ...(where ? { where } : {}),
      ...(order ? { orderBy: [order] } : {}),
    }),
    // The columns and the filters draw from the same referenced collections, so they are loaded as
    // one set: a relation that is both a column and a filter costs one request, not two.
    loadRelationOptions(client, schema, [...listColumns(collection), ...filterable]),
  ]);

  return {
    collection,
    records: records.slice(0, PAGE_SIZE),
    relationOptions: relations,
    relationLabels: relationLabels(relations),
    hasMore: records.length > PAGE_SIZE,
    offset,
    order,
    filters,
  };
};
