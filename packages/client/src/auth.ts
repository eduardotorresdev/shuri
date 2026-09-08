import { toClientError } from "./errors.js";
import type { Http } from "./http.js";

/** A user as `@shuri/auth` returns it: every public field, plus whatever the host declared. */
export interface ClientUser {
  id: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
  createdAt: number;
  [field: string]: unknown;
}

export interface Credentials {
  email: string;
  password: string;
  name?: string;
}

/** The OAuth2 client-credentials grant, as the token route answers it. */
export interface TokenGrant {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

export interface TokenRequest {
  clientId: string;
  clientSecret: string;
  /** The scopes to request, as a list or a space-separated string; every scope of the client's roles by default. */
  scope?: string | string[];
}

/** The auth routes `@shuri/auth` mounts, plus the token this client sends as a bearer. */
export interface AuthClient {
  signup(credentials: Credentials): Promise<{ user: ClientUser }>;
  login(credentials: Credentials): Promise<{ user: ClientUser }>;
  /** Revokes the session and forgets the token; 204 whether or not a session was found. */
  logout(): Promise<void>;
  /** The current user; throws a 401 `ClientError` when nobody is signed in. */
  me(): Promise<{ user: ClientUser }>;
  /** Obtains a client-credentials access token and sends it as a bearer from then on. */
  token(request: TokenRequest): Promise<TokenGrant>;
  /** The URL that starts an OIDC sign-in with `provider`; navigate the browser to it. */
  oidcUrl(provider: string, options?: { redirectTo?: string }): string;
  /** Sends `token` as `Authorization: Bearer` on every request from now on. */
  setToken(token: string): void;
  /** Stops sending a bearer; a browser session then rides on the cookie alone. */
  clearToken(): void;
  /** The bearer currently sent, if any. */
  getToken(): string | undefined;
}

export interface AuthClientOptions {
  basePath: string;
  /** The session cookie's name, read off `Set-Cookie` when the runtime exposes it. */
  cookieName: string;
}

/**
 * Binds the auth routes to `http`. A browser rides on the session cookie (`credentials:
 * "include"`) and never sees `Set-Cookie`; a runtime that exposes it (Node's `fetch` does) has no
 * cookie jar, so `signup`/`login` capture the session token off the header and send it as a bearer
 * from then on — `@shuri/auth` reads the bearer first, so both paths authenticate the same way.
 * @param http - The HTTP seam.
 * @param options - The auth base path and the session cookie's name.
 * @returns The auth client.
 */
export function authClient(http: Http, options: AuthClientOptions): AuthClient {
  const path = (route: string) => `${options.basePath}/${route}`;

  async function session(route: string, credentials: Credentials) {
    const response = await http.send("POST", path(route), { body: credentials });
    if (!response.ok) throw await toClientError(response);
    const token = sessionToken(response, options.cookieName);
    if (token) http.setToken(token);
    return (await response.json()) as { user: ClientUser };
  }

  return {
    signup: (credentials) => session("signup", credentials),
    login: (credentials) => session("login", credentials),
    async logout() {
      await http.json("POST", path("logout"));
      http.setToken(undefined);
    },
    me: () => http.json("GET", path("me")),
    async token({ clientId, clientSecret, scope }) {
      const body = new URLSearchParams({ grant_type: "client_credentials" });
      const scopes = Array.isArray(scope) ? scope.join(" ") : scope;
      if (scopes) body.set("scope", scopes);
      const grant = await http.json<TokenGrant>("POST", path("token"), {
        body,
        headers: {
          authorization: `Basic ${btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
      http.setToken(grant.access_token);
      return grant;
    },
    oidcUrl(provider, { redirectTo } = {}) {
      const query = new URLSearchParams();
      if (redirectTo) query.set("redirectTo", redirectTo);
      return http.url(path(`oidc/${encodeURIComponent(provider)}`), query);
    },
    setToken: (token) => http.setToken(token),
    clearToken: () => http.setToken(undefined),
    getToken: () => http.getToken(),
  };
}

/**
 * Reads the session token off a response's `Set-Cookie`, when the runtime exposes it. A browser
 * filters the header out entirely (`getSetCookie` answers `[]`), which is the signal to rely on
 * the cookie instead.
 * @param response - The signup/login response.
 * @param cookieName - The session cookie's name.
 * @returns The token, or `undefined` when the header isn't visible or doesn't carry it.
 */
export function sessionToken(response: Response, cookieName: string): string | undefined {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const prefix = `${cookieName}=`;
  const cookie = cookies.find((value) => value.startsWith(prefix));
  if (!cookie) return undefined;
  const value = decodeURIComponent(cookie.slice(prefix.length).split(";")[0]);
  return value || undefined;
}
