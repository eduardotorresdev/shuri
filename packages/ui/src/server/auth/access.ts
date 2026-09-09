import type { AuthSession } from "@shuri/auth";
import type { AdminApiPaths, AdminAuth, AdminViewer } from "../../shared/schema.js";
import { writesToApi } from "./protect.js";
import { resolveAdminSetup, type ResolvedAdminSetup } from "./setup.js";
import type { AdminAuthOptions } from "./types.js";
import { toAdminUser } from "./user.js";

/**
 * The outcome of asking "who is this, and may they use the admin?".
 *
 * One value carrying all three answers, so the schema handler and the guard cannot disagree: they
 * both call `resolve` and both branch on the same union — one turning it into a `viewer`, the other
 * into a status code.
 */
export type AdminAccess =
  /** No account exists yet, so there is nobody to be — the admin shows the first-account form. */
  | { status: "setup" }
  | { status: "anonymous" }
  | { status: "forbidden"; session: AuthSession }
  | { status: "allowed"; session: AuthSession };

/** Auth resolved to what the rest of the package uses: what to advertise, who is asking, what to guard. */
export interface ResolvedAdminAuth {
  /**
   * The `auth` block put on the schema document. A function, not a value: its `setup` block has to
   * disappear the moment the first account exists, which is a per-request question.
   */
  advertised(): Promise<AdminAuth>;
  resolve(request: Request): Promise<AdminAccess>;
  protect(request: Request): boolean;
  /** The resolved first-run flow, when the host declared one. */
  setup?: ResolvedAdminSetup;
}

/**
 * Turns an `AdminAccess` into the `viewer` the schema document carries.
 * @param access - The resolved access.
 * @returns The viewer, with the user projected down to the admin's three fields.
 */
export function toViewer(access: AdminAccess): AdminViewer {
  if (access.status === "setup") return { status: "setup" };
  if (access.status === "anonymous") return { status: "anonymous" };
  return { status: access.status, user: toAdminUser(access.session.user) };
}

/**
 * Resolves the host's auth options into the shape the handlers use, applying the defaults.
 * @param options - The host's auth options.
 * @param api - The REST base paths, for the default `protect`.
 * @param [adminBasePath] - The admin's mount path, which the default setup path hangs off.
 * @returns The resolved auth.
 */
export function resolveAdminAuth(
  options: AdminAuthOptions,
  api: AdminApiPaths,
  adminBasePath = "/admin",
): ResolvedAdminAuth {
  const authorize = options.authorize ?? (() => true);
  const protect = options.protect ?? writesToApi(api);
  const basePath = options.basePath ?? "/auth";
  const setup = options.setup
    ? resolveAdminSetup(options.setup, adminBasePath)
    : undefined;

  const base: Omit<AdminAuth, "setup"> = {
    basePath,
    signIn: options.signInPath ?? `${basePath}/login`,
    signOut: options.signOutPath ?? `${basePath}/logout`,
    providers: options.providers ?? [],
  };

  return {
    protect,
    setup,

    async advertised() {
      // Asked per request, not cached: `setup` has to vanish from the document the moment the first
      // account exists, and that moment is a request like any other.
      if (setup && (await setup.required())) return { ...base, setup: setup.advertised };
      return base;
    },

    async resolve(request) {
      const session = await options.auth.getSession(request);
      // A live session wins over setup: an account exists, so setup is over regardless of what the
      // host's `required()` currently says.
      if (!session) {
        return setup && (await setup.required())
          ? { status: "setup" }
          : { status: "anonymous" };
      }
      return (await authorize(session))
        ? { status: "allowed", session }
        : { status: "forbidden", session };
    },
  };
}
