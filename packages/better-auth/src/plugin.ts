import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { FallingHandler } from "@shuri/api";
import type { AuthSession } from "@shuri/auth";
import type { ShuriPlugin } from "@shuri/sdk";
import type { AdminSetupSource } from "@shuri/ui";
import { createShuriAdapter, type CreateShuriAdapterOptions } from "./adapter/factory.js";
import { betterAuthCollections } from "./collections.js";
import { toFallingHandler } from "./handler.js";
import { toSessionResolver } from "./session.js";
import { createBetterAuthSetup, type BetterAuthSetupOptions } from "./setup.js";

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
 * Resolves a request's session, in the shape `@shuri/ui`'s `AdminSessionSource` expects.
 *
 * Handed out **before** `create()` runs and bound afterwards, so a handler that needs it — the
 * admin's guard, most of all — can be composed in the same `create()` call that builds it. Without
 * the indirection the two would deadlock: the admin needs a session source, the session source needs
 * the store, and the store is what `create()` is in the middle of building.
 */
export interface BetterAuthSessionSource {
  getSession(request: Request): Promise<AuthSession | undefined>;
}

/** A `ShuriPlugin` that also exposes the pieces a host needs to wire other handlers to it. */
export interface BetterAuthPlugin extends ShuriPlugin {
  /** Where better-auth's routes are mounted — pass it to the admin so its login form posts there. */
  basePath: string;
  /** Resolves a request's session. Valid from the moment `create()` returns. */
  sessionSource: BetterAuthSessionSource;
  /**
   * Creates the app's first account, for `@shuri/ui`'s setup flow. Pass it as
   * `auth.setup.source` and the admin shows a first-account form while the user table is empty.
   *
   * Bound the same lazy way as `sessionSource`, and for the same reason.
   */
  setupSource: AdminSetupSource;
  /** The built better-auth instance, for `auth.api.*` calls. Throws before `create()` has run. */
  instance(): BetterAuthInstance;
}

/**
 * Runs better-auth on the app's own store, as one `create({ plugins })` entry.
 *
 * It contributes better-auth's tables as Shuri collections (derived from better-auth's own schema,
 * so enabling a plugin that adds columns needs no change here) and mounts better-auth's routes ahead
 * of the built-in ones. One persistence adapter, one set of migrations, one event bus.
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
 * @param config - better-auth's own options, plus adapter options.
 * @returns The plugin, with the session source and instance a host may need alongside it.
 */
export function betterAuthPlugin(config: BetterAuthPluginConfig = {}): BetterAuthPlugin {
  const options = config.options ?? {};
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;

  let built: BetterAuthInstance | undefined;
  let setup: AdminSetupSource | undefined;
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
    if (!setup) instance();
    return setup as AdminSetupSource;
  };

  return {
    name: "@shuri/better-auth",
    basePath,
    collections: betterAuthCollections(options),
    // Delegates through `instance()` rather than capturing anything, so this object is usable as an
    // argument to a handler composed in the same `create()` call that builds better-auth.
    sessionSource: {
      getSession: (request) => toSessionResolver(instance())(request),
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
      return [toFallingHandler(auth, basePath)];
    },
  };
}
