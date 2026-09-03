/**
 * Matches `basePath` exactly against `pathname`, tolerating a trailing slash. Unlike the collection
 * and global matchers there is nothing to extract from the path: a stream is selected entirely
 * through the query string, so one endpoint serves every resource.
 * @param pathname - The request URL's pathname.
 * @param basePath - The path the event stream is mounted at.
 * @returns Whether `pathname` addresses the event stream.
 */
export function matchRealtimeRoute(pathname: string, basePath: string): boolean {
  return stripTrailingSlash(pathname) === stripTrailingSlash(basePath);
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}
