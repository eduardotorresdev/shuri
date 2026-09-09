import type { AdminSetupOptions } from "./setup-types.js";
import type { UserAdminApi } from "../users/types.js";

/**
 * The user behind a session, as the admin sees it: the two fields it shows, plus whatever else the
 * auth implementation carries — a `role`, most usefully, which is what `authorize` reads.
 */
export interface AdminSessionUser {
  id: string;
  email: string;
  name?: string;
  [field: string]: unknown;
}

/** A live session, resolved from a request by the auth implementation. */
export interface AdminSession {
  id: string;
  user: AdminSessionUser;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * The one thing the admin needs from an auth implementation: resolving the session behind a
 * request. `@shuri/better-auth`'s `sessionSource` satisfies it, and so can a host with its own
 * session scheme — the shape is deliberately the admin's, not any one library's.
 */
export interface AdminSessionSource {
  getSession(request: Request): Promise<AdminSession | undefined>;
  /**
   * User administration, when the auth implementation has any. `@shuri/better-auth`'s session
   * source carries it, so passing that is all it takes to get the Users screens; an implementation
   * without it simply doesn't get them, and nothing else changes.
   */
  users?: UserAdminApi;
}

export interface AdminAuthOptions {
  /** Resolves each request's session — `ba.sessionSource` from `@shuri/better-auth`. */
  auth: AdminSessionSource;
  /**
   * Prefix the auth routes are mounted under. Must match the auth implementation's own. Defaults to
   * "/api/auth", which is better-auth's.
   */
  basePath?: string;
  /**
   * Full path the login form posts `{ email, password }` to. Defaults to
   * `{basePath}/sign-in/email`, which is better-auth's.
   */
  signInPath?: string;
  /** Full path the sign-out button posts to. Defaults to `{basePath}/sign-out`. */
  signOutPath?: string;
  /**
   * Social provider ids to offer as sign-in buttons, matching the ids the auth implementation
   * declares. Listed here rather than discovered, because a host may well want only some of its
   * providers on the admin's login screen.
   */
  providers?: readonly string[];
  /**
   * Decides whether a signed-in user may use the admin. Defaults to accepting any session.
   *
   * This is the whole of the admin's authorization story, on purpose: inventing roles here would
   * put a second, weaker permission model next to whatever the host already has. **With the
   * default, anyone who can sign up can edit everything** — an app with open signup wants something
   * like `(session) => session.user["role"] === "admin"`.
   */
  authorize?: (session: AdminSession) => boolean | Promise<boolean>;
  /**
   * Which requests require an authorized session. Defaults to `writesToApi` — every write to the
   * REST routes the admin edits through.
   *
   * Reads are left open by default because that is what a headless CMS's API is for, and because
   * closing them would change the behaviour of an app that merely added an admin. To close them
   * too, pass `everythingUnderApi`.
   */
  protect?: (request: Request) => boolean;
  /**
   * The Users screens: listing, creating, editing and deleting accounts. Defaults to `auth.users`,
   * so an app on `@shuri/better-auth` gets them by passing its session source.
   *
   * They sit behind `authorize` like everything else in the admin, which is worth saying out loud:
   * **whoever may use the admin may mint an account** — and with the default `authorize`, an account
   * is an admin. Pass `false` to leave the screens out, or a `UserAdminApi` of your own to put
   * something else behind them.
   */
  users?: UserAdminApi | false;
  /**
   * Turns on the first-run flow: while the app has no account, the admin shows a form that creates
   * one instead of a login form. Omitting it means the host seeds its first account some other way.
   */
  setup?: AdminSetupOptions;
}
