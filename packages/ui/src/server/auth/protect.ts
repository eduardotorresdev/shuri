import type { AdminApiPaths } from "../../shared/schema.js";

/** Methods that only read. Everything else changes stored data and is a write. */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether `pathname` is under one of the REST base paths the admin edits through.
 * @param pathname - The request URL's pathname.
 * @param api - The REST base paths.
 * @returns Whether the path belongs to the collections or globals routes.
 */
function underApi(pathname: string, api: AdminApiPaths): boolean {
  return [api.collections, api.globals].some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

/**
 * The default `protect`: every write to the REST routes, and nothing else.
 *
 * Writes rather than everything, because reads are what a headless CMS's API exists for — the site
 * that consumes it is not signed in. Closing them is a policy the host may well want, but it would
 * change how an app behaves merely because it gained an admin, which is not this package's call to
 * make. Pass `everythingUnderApi` for that.
 * @param api - The REST base paths.
 * @returns A predicate matching writes to those paths.
 */
export function writesToApi(api: AdminApiPaths): (request: Request) => boolean {
  return (request) =>
    !READ_METHODS.has(request.method) && underApi(new URL(request.url).pathname, api);
}

/**
 * A stricter `protect`: every request to the REST routes, reads included, so nothing but a
 * signed-in admin reads a draft.
 *
 * The cost is that the app is no longer publicly readable — anything consuming the API needs a
 * session of its own.
 * @param api - The REST base paths.
 * @returns A predicate matching every request to those paths.
 */
export function everythingUnderApi(api: AdminApiPaths): (request: Request) => boolean {
  return (request) => underApi(new URL(request.url).pathname, api);
}
