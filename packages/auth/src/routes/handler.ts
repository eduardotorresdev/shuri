import { toErrorResponse, type FallingHandler } from "@shuri/api";
import type { AuthContext } from "../config.js";
import { matchAuthRoute } from "../http/routes.js";
import { handleLogin } from "./login.js";
import { handleLogout } from "./logout.js";
import { handleMe } from "./me.js";
import { handleOidcCallback } from "./oidc-callback.js";
import { handleOidcStart } from "./oidc-start.js";
import { handleSignup } from "./signup.js";

/**
 * The package's HTTP surface: one falling handler serving every auth route under `basePath` and
 * returning `undefined` for everything else, so it composes with `@shuri/api`'s handlers exactly the
 * way they compose with each other.
 *
 * Every error thrown below extends `ApiError` or `IssuesApiError`, so `toErrorResponse` maps it with
 * no changes on the `@shuri/api` side — the import edge only ever points `auth -> api`.
 * @param context - The resolved auth context.
 * @returns The falling handler for the auth routes.
 */
export function createAuthHandler(context: AuthContext): FallingHandler {
  return async function handleRequest(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    const route = matchAuthRoute(url.pathname, context.basePath);
    if (!route) return undefined;

    try {
      switch (route.name) {
        case "signup":
          return await handleSignup(context, request);
        case "login":
          return await handleLogin(context, request);
        case "logout":
          return await handleLogout(context, request);
        case "me":
          return await handleMe(context, request);
        case "oidc-start":
          return await handleOidcStart(context, request, route.provider as string);
        case "oidc-callback":
          return await handleOidcCallback(context, request, route.provider as string);
        default:
          return undefined;
      }
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
