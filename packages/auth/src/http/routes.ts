/** The auth routes, resolved from a request path. */
export type AuthRouteName =
  "signup" | "login" | "logout" | "me" | "oidc-start" | "oidc-callback";

export interface AuthRoute {
  name: AuthRouteName;
  /** The provider id, for the two OIDC routes. */
  provider?: string;
}

/**
 * Matches the auth routes under `basePath`, returning `undefined` for anything outside it — the
 * fall-through contract every handler in `@shuri/api` follows, so this one composes with them.
 * @param pathname - The request URL's pathname.
 * @param basePath - The prefix the auth routes are mounted under.
 * @returns The matched route, or `undefined` when `pathname` isn't one of ours.
 */
export function matchAuthRoute(
  pathname: string,
  basePath: string,
): AuthRoute | undefined {
  if (!pathname.startsWith(basePath)) return undefined;

  const rest = pathname.slice(basePath.length).replace(/^\/+/, "").replace(/\/+$/, "");
  const segments = rest ? rest.split("/") : [];

  if (segments.length === 1) {
    const [name] = segments;
    if (name === "signup" || name === "login" || name === "logout" || name === "me") {
      return { name };
    }
    return undefined;
  }

  if (segments[0] !== "oidc" || !segments[1]) return undefined;
  if (segments.length === 2) return { name: "oidc-start", provider: segments[1] };
  if (segments.length === 3 && segments[2] === "callback") {
    return { name: "oidc-callback", provider: segments[1] };
  }
  return undefined;
}
