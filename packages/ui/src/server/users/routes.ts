/** A request path resolved against the users routes: the collection itself, or one user. */
export interface AdminUsersRoute {
  id?: string;
}

/**
 * Matches `{path}` and `{path}/:id`, and nothing else.
 *
 * Its own matcher rather than `@shuri/api`'s `matchCollectionRoute`: that one reads a slug out of
 * the first segment, and here the slug is the mount path — there is exactly one collection behind
 * these routes, and `{path}/users` must be an id, not a second collection.
 * @param pathname - The request URL's pathname.
 * @param path - The path the users routes are mounted at.
 * @returns The matched route, or `undefined` for anything outside `path`.
 */
export function matchUsersRoute(
  pathname: string,
  path: string,
): AdminUsersRoute | undefined {
  if (pathname === path || pathname === `${path}/`) return {};
  if (!pathname.startsWith(`${path}/`)) return undefined;

  const rest = pathname.slice(path.length + 1).replace(/\/+$/, "");
  if (!rest || rest.includes("/")) return undefined;

  return { id: decodeURIComponent(rest) };
}
