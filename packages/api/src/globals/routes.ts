/** A request path resolved to a global slug. */
export interface GlobalRoute {
  slug: string;
}

/**
 * Matches `{basePath}/:slug` against `pathname`: a global is a single record, so the match ends at
 * `:slug` (`matchCollectionRoute` also matches a trailing `:id`). Returns `undefined` for anything
 * outside `basePath` or with extra path segments.
 * @param pathname - The request URL's pathname.
 * @param basePath - The path prefix global routes are mounted under.
 * @returns The matched route, or `undefined` if `pathname` doesn't match.
 */
export function matchGlobalRoute(
  pathname: string,
  basePath: string,
): GlobalRoute | undefined {
  if (!pathname.startsWith(basePath)) return undefined;

  const rest = pathname.slice(basePath.length).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rest) return undefined;

  const [slug, ...extra] = rest.split("/");
  if (!slug || extra.length > 0) return undefined;

  return { slug };
}
