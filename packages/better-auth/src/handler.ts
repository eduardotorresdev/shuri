import type { FallingHandler } from "@shuri/api";

/** The slice of a better-auth instance this package's HTTP glue needs. */
export interface BetterAuthHandler {
  handler(request: Request): Promise<Response>;
}

/**
 * Wraps better-auth's handler as a `FallingHandler`, so it composes with every other Shuri handler.
 *
 * The only difference between the two contracts is what happens off-route: better-auth answers 404,
 * Shuri's chain expects `undefined` so the next handler gets its turn. Without this, mounting
 * better-auth would swallow the whole app — its 404 would be the final word on `/collections/posts`.
 *
 * `basePath` has to match better-auth's own (`options.basePath`, default `/api/auth`); it is the one
 * thing this wrapper needs to know in order to tell "not mine" from "mine, and missing".
 * @param auth - The better-auth instance.
 * @param basePath - The prefix better-auth's routes are mounted under.
 * @returns A handler answering better-auth's routes, `undefined` for everything else.
 */
export function toFallingHandler(
  auth: BetterAuthHandler,
  basePath: string,
): FallingHandler {
  return async function handleRequest(request) {
    const { pathname } = new URL(request.url);
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return undefined;
    return auth.handler(request);
  };
}
