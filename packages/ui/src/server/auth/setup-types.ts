/** The credentials a first-account request carries, once validated. */
export interface AdminSetupCredentials {
  email: string;
  password: string;
  name?: string;
}

/**
 * How a host creates the app's very first account.
 *
 * Two functions rather than one, because the admin has to answer two different questions at two
 * different times: "should I show the setup form at all?" on every schema read, and "create this
 * account" once. `@shuri/better-auth` ships an implementation; a host with its own auth writes both in
 * a few lines.
 */
export interface AdminSetupSource {
  /**
   * Whether the app still has no account, asked on every schema read and again inside the lock
   * before creating one.
   *
   * Answering `true` opens an **unauthenticated** route that creates an administrator. It must go
   * back to `false` the moment an account exists — normally "the users table is empty", which does
   * exactly that.
   */
  required(): Promise<boolean>;
  /**
   * Creates the account and answers as a sign-in would, session cookie included.
   *
   * Returns a `Response` rather than a user because the cookie is the point: whoever completes setup
   * has to end up signed in, and both auth implementations already have a route that produces
   * exactly this.
   */
  create(credentials: AdminSetupCredentials, request: Request): Promise<Response>;
}

export interface AdminSetupOptions {
  /** Creates the first account, and says whether one is still needed. */
  source: AdminSetupSource;
  /**
   * A one-time token the request must carry, in `x-shuri-setup-token` or a `token` body field.
   *
   * **Strongly recommended for anything reachable from the internet.** Setup cannot be
   * authenticated — there is no account yet — so without a token the admin belongs to whoever
   * finds the URL first. With one, it belongs to whoever can read the deployment's own config.
   */
  token?: string;
  /** Path the first-account form posts to. Defaults to `{admin basePath}/setup`. */
  path?: string;
}
