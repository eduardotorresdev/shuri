import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { FallingHandler, PrincipalResolver } from "@shuri/api";
import type { ShuriPlugin } from "@shuri/sdk";
import type { AdminSessionSource, AdminSetupSource, UserAdminApi } from "@shuri/ui";
import { createShuriAdapter, type CreateShuriAdapterOptions } from "./adapter/factory.js";
import { betterAuthCollections } from "./collections.js";
import { toFallingHandler } from "./handler.js";
import { betterAuthOpenApiSecurity } from "./openapi.js";
import { toPrincipalResolver } from "./principal.js";
import { toSessionResolver } from "./session.js";
import { createBetterAuthSetup, type BetterAuthSetupOptions } from "./setup.js";
import { createBetterAuthUsers } from "./users.js";

/** better-auth's default mount point, and what `basePath` falls back to. */
const DEFAULT_BASE_PATH = "/api/auth";

export interface BetterAuthPluginConfig {
  /**
   * The very same options `betterAuth()` takes, minus `database` — this plugin supplies that, backed
   * by the app's own store.
   */
  options?: Omit<BetterAuthOptions, "database">;
  /** Adapter options, e.g. `debugLogs`. */
  adapter?: CreateShuriAdapterOptions;
  /**
   * Options for the first-run flow exposed as `setupSource` — the fields to stamp on the account it
   * creates, most of all. Setup itself is turned on by handing `setupSource` to the admin.
   */
  setup?: BetterAuthSetupOptions;
}

/**
 * Builds the better-auth instance over a Shuri-backed adapter.
 *
 * A named function rather than an inline call so `BetterAuthInstance` can be inferred from it:
 * `betterAuth`'s return type is parameterised on the exact options object it was handed, and the
 * widened `Auth<BetterAuthOptions>` is not assignable from it.
 * @param options - better-auth's own options, minus `database`.
 * @param adapter - The Shuri-backed adapter factory to use as `database`.
 * @returns The better-auth instance.
 */
function buildBetterAuth(
  options: Omit<BetterAuthOptions, "database">,
  adapter: ReturnType<typeof createShuriAdapter>,
) {
  return betterAuth({ ...options, database: adapter });
}

/** The instance better-auth built, once `create()` has run. */
export type BetterAuthInstance = ReturnType<typeof buildBetterAuth>;

/**
 * A `ShuriPlugin` that also exposes the pieces a host needs to wire other handlers to it.
 *
 * Everything on it is handed out **before** `create()` runs and bound afterwards, so a handler that
 * needs it — the admin, most of all — can be composed in the same `create()` call that builds
 * better-auth. Without the indirection the two would deadlock: the admin needs a session source,
 * the session source needs the store, and the store is what `create()` is in the middle of
 * building.
 */
export interface BetterAuthPlugin extends ShuriPlugin {
  /** Where better-auth's routes are mounted — pass it to the admin so its login form posts there. */
  basePath: string;
  /**
   * Resolves a request's session, in the shape `@shuri/ui`'s admin expects, and carries `users` so
   * passing it as `auth.auth` is all it takes to get the Users screens. Valid from the moment
   * `create()` returns.
   */
  sessionSource: AdminSessionSource & { users: UserAdminApi };
  /**
   * Creates the app's first account, for `@shuri/ui`'s setup flow. Pass it as
   * `auth.setup.source` and the admin shows a first-account form while the user table is empty.
   */
  setupSource: AdminSetupSource;
  /** The built better-auth instance, for `auth.api.*` calls. Throws before `create()` has run. */
  instance(): BetterAuthInstance;
}

/**
 * Runs better-auth on the app's own store, as one `create({ plugins })` entry.
 *
 * It contributes better-auth's tables as Shuri collections (derived from better-auth's own schema,
 * so enabling a plugin that adds columns needs no change here), mounts better-auth's routes ahead
 * of the built-in ones, and hands `create()` a principal resolver — which is what turns the
 * `access` rules of every collection and global on. One persistence adapter, one set of
 * migrations, one event bus.
 *
 *   const ba = betterAuthPlugin({ options: { emailAndPassword: { enabled: true } } });
 *
 *   const app = create({
 *     collections,
 *     adapter,
 *     plugins: [
 *       ba,
 *       { name: "admin", handlers: () => [
 *         createAdminHandler({ collections }, { auth: { auth: ba.sessionSource, basePath: ba.basePath } }),
 *       ] },
 *     ],
 *   });
 * @param config - better-auth's own options, plus adapter and setup options.
 * @returns The plugin, with the session source and instance a host may need alongside it.
 */
export function betterAuthPlugin(config: BetterAuthPluginConfig = {}): BetterAuthPlugin {
  const options = config.options ?? {};
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const userModel = config.setup?.userModel ?? "user";

  let built: BetterAuthInstance | undefined;
  let setup: AdminSetupSource | undefined;
  let users: UserAdminApi | undefined;
  const instance = (): BetterAuthInstance => {
    if (!built) {
      throw new Error(
        "better-auth is not built yet. `betterAuthPlugin(...)` only builds it once passed to " +
          "`create({ plugins })`; call this after that.",
      );
    }
    return built;
  };
  const resolvedSetup = (): AdminSetupSource => {
    instance();
    return setup as AdminSetupSource;
  };
  const resolvedUsers = (): UserAdminApi => {
    instance();
    return users as UserAdminApi;
  };
  const principal: PrincipalResolver = (request) =>
    toPrincipalResolver(instance())(request);

  return {
    name: "@shuri/better-auth",
    basePath,
    collections: betterAuthCollections(options),
    principal,
    openapi: { security: betterAuthOpenApiSecurity(options) },
    // Delegates through `instance()` rather than capturing anything, so this object is usable as an
    // argument to a handler composed in the same `create()` call that builds better-auth.
    sessionSource: {
      getSession: (request) => toSessionResolver(instance())(request),
      users: {
        list: (query) => resolvedUsers().list(query),
        get: (id) => resolvedUsers().get(id),
        create: (input) => resolvedUsers().create(input),
        update: (id, patch) => resolvedUsers().update(id, patch),
        remove: (id) => resolvedUsers().remove(id),
      },
    },
    setupSource: {
      required: () => resolvedSetup().required(),
      create: (credentials, request) => resolvedSetup().create(credentials, request),
    },
    instance,

    handlers({ store }): readonly FallingHandler[] {
      const auth = buildBetterAuth(options, createShuriAdapter(store, config.adapter));
      built = auth;
      setup = createBetterAuthSetup(auth, store, basePath, config.setup);
      users = createBetterAuthUsers(auth, store, userModel);
      return [toFallingHandler(auth, basePath)];
    },
  };
}
