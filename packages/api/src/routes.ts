/** A request path resolved to a collection slug and, if present, a record id. */
export interface CollectionRoute {
  slug: string;
  id?: string;
}

/**
 * Matches `{basePath}/:slug` and `{basePath}/:slug/:id` against `pathname`. Returns `undefined` for
 * anything outside `basePath` or with extra path segments.
 */
export function matchCollectionRoute(pathname: string, basePath: string): CollectionRoute | undefined {
  if (!pathname.startsWith(basePath)) return undefined;

  const rest = pathname.slice(basePath.length).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rest) return undefined;

  const [slug, id, ...extra] = rest.split("/");
  if (!slug || extra.length > 0) return undefined;

  return id ? { slug, id } : { slug };
}
