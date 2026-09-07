import type { AuthSession, UserAdminApi } from "@shuri/auth";
import type { AdminSetupOptions } from "./setup-types.js";

/**
 * The one thing the admin needs from `@shuri/auth`: resolving the session behind a request.
 * `@shuri/sdk`'s `app.auth` satisfies it structurally, so nothing has to be adapted at the call
 * site, and a host with its own session scheme can satisfy it too.
 */
export interface AdminSessionSource {
  getSession(request: Request): Promise<AuthSession | undefined>;
  /**
   * User administration, when the auth implementation has any. `app.auth` carries it, so passing
   * that is all it takes to get the Users screens; an implementation without it simply doesn't get
   * them, and nothing else changes.
   */
  users?: UserAdminApi;
}

export interface AdminAuthOptions {
  /** Resolves each request's session — `app.auth` from `@shuri/sdk`. */
  auth: AdminSessionSource;
  /**
   * Prefix the auth routes are mounted under. Must match the auth implementation's own. Defaults to
   * "/auth", which is `@shuri/auth`'s.
   */
  basePath?: string;
  /**
   * Full path the login form posts `{ email, password }` to. Defaults to `{basePath}/login`, which
   * is `@shuri/auth`'s; `@shuri/better-auth` serves `{basePath}/sign-in/email`.
   */
  signInPath?: string;
  /** Full path the sign-out button posts to. Defaults to `{basePath}/logout`. */
  signOutPath?: string;
  /**
   * OIDC provider ids to offer as sign-in buttons, matching the ids declared in `AuthConfig
   * .providers`. Listed here rather than discovered, because a host may well want only some of its
   * providers on the admin's login screen.
   */
  providers?: readonly string[];
  /**
   * Decides whether a signed-in user may use the admin. Defaults to accepting any session.
   *
   * This is the whole of the admin's authorization story, on purpose: `@shuri/auth` has no roles,
   * and inventing some here would put a second, weaker permission model next to whatever the host
   * already has. **With the default, anyone who can sign up can edit everything** — an app with open
   * signup wants something like `(session) => session.user["role"] === "editor"`.
   */
  authorize?: (session: AuthSession) => boolean | Promise<boolean>;
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
   * so an app on `@shuri/auth` gets them by passing `app.auth`.
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
