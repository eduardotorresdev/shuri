import { AdminRequestError } from "./errors.js";
import type { AdminAuth } from "./schema.js";
import type { AdminClientOptions, FetchLike } from "./client.js";

/** What the login form collects. Matches `@shuri/auth`'s `POST {basePath}/login` body. */
export interface AdminCredentials {
  email: string;
  password: string;
}

/**
 * Sign-in and sign-out against `@shuri/auth`'s own routes.
 *
 * Deliberately thin: the session lives in an `HttpOnly` cookie the browser carries by itself, so
 * there is no token for this client to hold, store or attach. Both methods are one request whose
 * only lasting effect is that cookie.
 */
export interface AdminAuthClient {
  signIn(credentials: AdminCredentials): Promise<void>;
  signOut(): Promise<void>;
  /** Where the browser goes to start an OIDC sign-in, landing back at `returnTo` afterwards. */
  oidcUrl(provider: string, returnTo: string): string;
}

/**
 * Reads the error off a failed auth response.
 *
 * `@shuri/auth` answers every credential failure with the same generic 401 — wrong password, unknown
 * email and a malformed body are indistinguishable on purpose — so there is nothing to unpack per
 * field here, unlike a record write.
 * @param response - The non-2xx response.
 * @returns The error describing it.
 */
async function toAuthError(response: Response): Promise<AdminRequestError> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // Falls through to the status-only message.
  }
  return new AdminRequestError(response.status, message);
}

/**
 * Binds sign-in and sign-out to the auth routes the schema advertises.
 * @param auth - The `auth` block of the admin schema.
 * @param [options] - The `fetch` to use and the origin to resolve against.
 * @returns A client over the app's auth routes.
 */
export function createAdminAuthClient(
  auth: AdminAuth,
  options: AdminClientOptions = {},
): AdminAuthClient {
  const doFetch: FetchLike = options.fetch ?? globalThis.fetch;
  const origin = options.origin ?? "";

  return {
    async signIn(credentials) {
      const response = await doFetch(`${origin}${auth.signIn}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) throw await toAuthError(response);
    },

    async signOut() {
      // POST, not GET: a GET logout is fired by any `<img src>`, and by link prefetchers. Both auth
      // implementations the admin speaks to refuse one.
      const response = await doFetch(`${origin}${auth.signOut}`, { method: "POST" });
      if (!response.ok) throw await toAuthError(response);
    },

    oidcUrl(provider, returnTo) {
      const base = `${origin}${auth.basePath}`;
      return `${base}/oidc/${encodeURIComponent(provider)}?redirectTo=${encodeURIComponent(returnTo)}`;
    },
  };
}

/** Shown for every refused sign-in, whichever way it was refused. */
export const SIGN_IN_REFUSED = "E-mail ou senha inválidos.";

/**
 * The message a login form shows for a failed sign-in.
 *
 * 400 and 401 collapse into one sentence. They are the shape check and the credential check, and
 * `@shuri/auth` already answers a wrong password and an unknown email identically on purpose — so
 * distinguishing them here would undo that, and the 400's own text names an internal field path
 * (`body.password`) that means nothing to whoever is typing.
 *
 * Anything else keeps its own message: a 500 or a dropped connection is not a wrong password, and
 * saying it was would send the user round the same loop forever.
 * @param error - The error `signIn` threw.
 * @returns The message to show.
 */
export function signInErrorMessage(error: unknown): string {
  if (
    error instanceof AdminRequestError &&
    (error.status === 400 || error.status === 401)
  ) {
    return SIGN_IN_REFUSED;
  }
  return error instanceof Error ? error.message : String(error);
}
