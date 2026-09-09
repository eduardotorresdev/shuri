import { ClientError, toClientError } from "./errors.js";
import type { Http } from "./http.js";

/** A user as better-auth returns it: its own fields, plus whatever the host declared. */
export interface ClientUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
  [field: string]: unknown;
}

/** A session as better-auth returns it alongside the user. */
export interface ClientSession {
  id: string;
  expiresAt: string;
  [field: string]: unknown;
}

export interface Credentials {
  email: string;
  password: string;
  /** Required by better-auth on signup; the address stands in when absent. */
  name?: string;
}

export interface SocialSignInOptions {
  /** Where the provider lands the browser afterwards. */
  callbackURL?: string;
}

/** The auth routes better-auth mounts, plus the token this client sends as a bearer. */
export interface AuthClient {
  signup(credentials: Credentials): Promise<{ user: ClientUser }>;
  login(credentials: Credentials): Promise<{ user: ClientUser }>;
  /** Ends the session and forgets the cookies held. */
  logout(): Promise<void>;
  /** The current user and session; throws a 401 `ClientError` when nobody is signed in. */
  me(): Promise<{ user: ClientUser; session: ClientSession }>;
  /** Starts a social sign-in with `provider`, resolving to the URL to navigate the browser to. */
  socialSignInUrl(provider: string, options?: SocialSignInOptions): Promise<string>;
  /** Sends `token` as `Authorization: Bearer` on every request from now on (better-auth's `bearer` plugin). */
  setToken(token: string): void;
  /** Stops sending a bearer; a browser session then rides on the cookie alone. */
  clearToken(): void;
  /** The bearer currently sent, if any. */
  getToken(): string | undefined;
}

export interface AuthClientOptions {
  basePath: string;
}

/**
 * Binds better-auth's routes to `http`. A browser rides on the session cookie (credentials
 * "include") and never sees `Set-Cookie`; a runtime that exposes it (Node's `fetch` does) has no
 * cookie jar, so `http`'s own jar captures the session off `signup`/`login` and sends it back from
 * then on — both paths authenticate the same way.
 * @param http - The HTTP seam.
 * @param options - The auth base path.
 * @returns The auth client.
 */
export function authClient(http: Http, options: AuthClientOptions): AuthClient {
  const path = (route: string) => `${options.basePath}/${route}`;

  async function session(route: string, body: unknown) {
    const response = await http.send("POST", path(route), { body });
    if (!response.ok) throw await toClientError(response);
    return (await response.json()) as { user: ClientUser };
  }

  return {
    signup: ({ email, password, name }) =>
      session("sign-up/email", { email, password, name: name ?? email }),
    login: ({ email, password }) => session("sign-in/email", { email, password }),
    async logout() {
      await http.json("POST", path("sign-out"));
      http.clearCookies();
    },
    async me() {
      // better-auth answers `null` with a 200 for no session; the client turns that into the 401
      // every other route answers, so a caller checks one thing.
      const current = await http.json<{
        user: ClientUser;
        session: ClientSession;
      } | null>("GET", path("get-session"));
      if (!current) throw new ClientError(401, "Not authenticated");
      return current;
    },
    async socialSignInUrl(provider, { callbackURL } = {}) {
      const { url } = await http.json<{ url: string }>("POST", path("sign-in/social"), {
        body: { provider, ...(callbackURL ? { callbackURL } : {}) },
      });
      return url;
    },
    setToken: (token) => http.setToken(token),
    clearToken: () => http.setToken(undefined),
    getToken: () => http.getToken(),
  };
}
