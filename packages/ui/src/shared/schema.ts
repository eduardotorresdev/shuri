import type { Field } from "@shuri/core";

/**
 * Where the admin expects each REST surface to live, so the browser can build request URLs without
 * assuming the defaults. Mirrors the `basePath` options of `@shuri/api`'s handlers, which the host
 * is free to move.
 */
export interface AdminApiPaths {
  collections: string;
  globals: string;
  events: string;
}

/** A collection as the admin renders it: the declared schema minus everything HTTP won't serve. */
export interface AdminCollection {
  slug: string;
  title: string;
  singular: string;
  plural: string;
  orderable?: boolean;
  fields: readonly Field[];
  /**
   * The field whose value labels a record in a list or a relation picker. Derived rather than
   * declared: the first `text`/`email` field, or `undefined` when the collection has none — in
   * which case the admin falls back to the record's `id`.
   */
  labelField?: string;
}

/**
 * Where the auth routes live and how a visitor may sign in. Absent when the admin has no auth wired
 * in.
 *
 * The two credential paths are carried in full rather than derived from `basePath`, because the
 * admin is not tied to one auth implementation: `@shuri/auth` serves `/auth/login` and
 * `/auth/logout`, `@shuri/better-auth` serves `/api/auth/sign-in/email` and `/api/auth/sign-out`.
 * Whoever mounts the admin says which.
 */
export interface AdminAuth {
  /** Prefix the auth routes are mounted under, e.g. `/auth`. Used to build the OIDC start URLs. */
  basePath: string;
  /** Full path the login form posts `{ email, password }` to. */
  signIn: string;
  /** Full path the sign-out button posts to. */
  signOut: string;
  /** OIDC provider ids offered as sign-in buttons, in the order the host declared them. */
  providers: readonly string[];
  /**
   * Where the first-account form posts, present only while the app still has no account to sign in
   * with. It disappears from this document the moment setup completes, which is also the moment the
   * route behind it starts refusing.
   */
  setup?: AdminSetup;
}

/** The first-run flow: how to create the account that will own the admin. */
export interface AdminSetup {
  /** Full path the first-account form posts `{ email, password, name? }` to. */
  path: string;
  /**
   * Whether the host requires a one-time token alongside those credentials.
   *
   * Setup is necessarily open — there is no account yet to authenticate against — so on a public URL
   * it is a race to claim the admin. A token closes that: the operator reads it from their own
   * deployment and nobody else can finish setup without it.
   */
  tokenRequired: boolean;
}

/**
 * The users screens: where they post, and the shape they render.
 *
 * Present only when the host's auth implementation offers user administration **and** the caller may
 * use the admin — it is stripped from the shell document alongside `collections`, since knowing that
 * a users route exists is knowing where to aim.
 *
 * `path` is under the admin's own mount, not under `api.collections`: the `users` collection is
 * `internal`, so it is not served over REST at all, and these screens go through the one route that
 * is guarded by the admin's own `authorize`.
 */
export interface AdminUsers {
  /** Full path the users routes are mounted at, e.g. `/admin/users`. */
  path: string;
  /** The collection as the screens render it — the same shape every other list and form is built from. */
  collection: AdminCollection;
  /** The auth implementation's own minimum, so the form states the policy the server will enforce. */
  passwordMinLength: number;
}

/** The signed-in user, as the admin's header shows them. A projection of `@shuri/auth`'s `AuthUser`. */
export interface AdminUser {
  id: string;
  email: string;
  name?: string;
}

/**
 * Who is asking, and whether they may use the admin — three states, as one union rather than a
 * `user` plus an `authorized` flag, so "signed in but refused" cannot be confused with either
 * neighbour and the admin's screens switch on a single value.
 *
 * `forbidden` is authenticated but turned away by the host's `authorize`: `@shuri/auth` has no roles
 * of its own, so who counts as an editor is a question only the host can answer.
 */
export type AdminViewer =
  /** The app has no account at all yet: the admin shows the first-account form, not the login one. */
  | { status: "setup" }
  | { status: "anonymous" }
  | { status: "forbidden"; user: AdminUser }
  | { status: "allowed"; user: AdminUser };

/** A global as the admin renders it: one record, one form, grouped in the sidebar by `category`. */
export interface AdminGlobal {
  slug: string;
  title: string;
  category: string;
  fields: readonly Field[];
}

/**
 * Everything the admin needs to draw itself, served as one document at `{basePath}/schema.json`.
 *
 * The whole UI is generated from this: it holds no knowledge of any particular collection, so a
 * field added to a schema shows up in the admin as soon as the app restarts, with no rebuild.
 */
export interface AdminSchema {
  title: string;
  basePath: string;
  api: AdminApiPaths;
  /**
   * Present exactly when the host wired auth in. Its absence is what tells the admin it is open —
   * so an app with no auth keeps working unchanged, and one with auth never renders a login form
   * that posts nowhere.
   */
  auth?: AdminAuth;
  /**
   * Who is asking. Present exactly when `auth` is.
   *
   * Anything other than `allowed` comes with **empty** `collections` and `globals`. This document
   * is served to anyone, because the login form is drawn from it and has to know where to post; so
   * what a caller with no access may learn is only "there is an admin here, and this is how you
   * sign in" — never which collections exist or what fields they hold.
   */
  viewer?: AdminViewer;
  /** Present exactly when the users screens are available to this caller. See {@link AdminUsers}. */
  users?: AdminUsers;
  collections: readonly AdminCollection[];
  globals: readonly AdminGlobal[];
}
