import { AdminRequestError } from "./errors.js";
import type { AdminAuth } from "./schema.js";
import type { AdminClientOptions, FetchLike } from "./client.js";

/** What the login form collects. Matches better-auth's `POST {basePath}/sign-in/email` body. */
export interface AdminCredentials {
  email: string;
  password: string;
}

/**
 * Sign-in and sign-out against the routes the schema document advertises.
 *
 * Deliberately thin: the session lives in an `HttpOnly` cookie the browser carries by itself, so
 * there is no token for this client to hold, store or attach. Every method is one request whose
 * only lasting effect is that cookie.
 */
export interface AdminAuthClient {
  signIn(credentials: AdminCredentials): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Starts a social sign-in with `provider`, resolving to the URL the browser must navigate to; the
   * provider lands back at `returnTo` afterwards.
   */
  signInSocial(provider: string, returnTo: string): Promise<string>;
}

/**
 * Reads the error off a failed auth response.
 *
 * better-auth answers every credential failure with the same generic 401 — wrong password and
 * unknown email are indistinguishable on purpose — so there is nothing to unpack per field here,
 * unlike a record write.
 * @param response - The non-2xx response.
 * @returns The error describing it.
 */
async function toAuthError(response: Response): Promise<AdminRequestError> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string") message = body.message;
    else if (typeof body.error === "string") message = body.error;
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

  async function post(path: string, body?: unknown): Promise<Response> {
    const response = await doFetch(`${origin}${path}`, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) throw await toAuthError(response);
    return response;
  }

  return {
    async signIn(credentials) {
      await post(auth.signIn, credentials);
    },

    async signOut() {
      // POST, not GET: a GET logout is fired by any `<img src>`, and by link prefetchers.
      await post(auth.signOut);
    },

    async signInSocial(provider, returnTo) {
      // A social sign-in is a full-page round trip to another origin, which XHR cannot follow: the
      // route answers with the URL, and the caller navigates there.
      const response = await post(`${auth.basePath}/sign-in/social`, {
        provider,
        callbackURL: returnTo,
      });
      const { url } = (await response.json()) as { url?: unknown };
      if (typeof url !== "string") {
        throw new AdminRequestError(response.status, "Sign-in returned no URL");
      }
      return url;
    },
  };
}

/** Shown for every refused sign-in, whichever way it was refused. */
export const SIGN_IN_REFUSED = "E-mail ou senha inválidos.";

/**
 * The message a login form shows for a failed sign-in.
 *
 * 400 and 401 collapse into one sentence. They are the shape check and the credential check, and
 * better-auth already answers a wrong password and an unknown email identically on purpose — so
 * distinguishing them here would undo that, and the 400's own text names a field that means nothing
 * to whoever is typing.
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
