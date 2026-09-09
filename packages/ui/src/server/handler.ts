import type { FallingHandler } from "@shuri/api";
import { createAdminAssetsHandler } from "./assets/handler.js";
import { loadAdminAssets } from "./assets/load.js";
import type { AdminAssets } from "./assets/types.js";
import { resolveAdminAuth } from "./auth/access.js";
import { createAdminGuard } from "./auth/guard.js";
import { createAdminSetupHandler } from "./auth/setup.js";
import type { AdminAuthOptions } from "./auth/types.js";
import { adminUsers, buildAdminSchema, type AdminSchemaSource } from "./schema/build.js";
import { createAdminSchemaHandler } from "./schema/handler.js";
import { createAdminUsersHandler } from "./users/handler.js";
import type { AdminApiPaths, AdminSchema } from "../shared/schema.js";

export interface CreateAdminHandlerOptions {
  /**
   * The path the admin is mounted at. Defaults to "/admin".
   *
   * Baked into the client bundle at build time as well, so changing it here alone breaks every
   * asset URL. Serve the admin elsewhere by rebuilding the package with `SHURI_ADMIN_BASE` set to
   * the same value (see `svelte.config.js`).
   */
  basePath?: string;
  /** Name shown in the admin's header. Defaults to "Shuri Admin". */
  title?: string;
  /**
   * Where the app's REST routes live, when they aren't at their own defaults. Must match the
   * `basePath` given to `@shuri/api`'s handlers — the admin builds its request URLs from these.
   */
  api?: Partial<AdminApiPaths>;
  /**
   * The client bundle to serve. Defaults to reading this package's own `build/` directory through
   * `loadAdminAssets`, which needs `node:fs`; pass a map to serve the admin from a runtime that has
   * no filesystem, or `false` to serve the schema document only and host the UI yourself.
   */
  assets?: AdminAssets | false;
  /**
   * Puts the admin behind a login. Omitting it leaves the admin — and the REST routes — exactly as
   * open as they were.
   *
   * Takes the auth plugin's session source, so mount the admin as a plugin beside it — the source is
   * bound by the same `create()` call:
   *
   *   plugins: [ba, { name: "admin", handlers: () => [
   *     createAdminHandler({ collections, globals }, { auth: { auth: ba.sessionSource } }),
   *   ] }]
   */
  auth?: AdminAuthOptions;
}

/**
 * Serves the visual admin: the schema document at `{basePath}/schema.json`, and the client bundle
 * that generates its whole UI from that document, under `{basePath}`.
 *
 * Takes the declared schemas rather than a `Core` or a `Store` because it needs nothing else — the
 * admin reads and writes records from the browser, over the app's own REST routes. So this handler
 * never touches data, and adding it grants no access that `@shuri/api` wasn't already granting.
 *
 * With `options.auth` it also grants less: the schema document withholds every collection from a
 * caller without an authorized session, and the guard refuses the writes the admin would make. See
 * `auth/guard.ts` for what that does and does not cover — by default, reads stay public.
 *
 * **Without `options.auth` there is no access control at all.** Mounting it exposes an editing UI
 * for every collection the REST routes already expose, to whoever can reach them.
 *
 * Compose it into an app through `create()`'s `handlers`:
 *
 *   create({ collections, globals, adapter, handlers: [createAdminHandler({ collections, globals })] })
 * @param source - The declared collections and globals to administer.
 * @param [options] - The mount path, title, REST base paths, client bundle, and auth.
 * @returns A handler serving the admin, `undefined` for anything outside `basePath`.
 */
export function createAdminHandler(
  source: AdminSchemaSource,
  options: CreateAdminHandlerOptions = {},
): FallingHandler {
  // The `auth` block is resolved separately below and merged in, so only the plain options go here.
  const base = buildAdminSchema(source, {
    title: options.title,
    basePath: options.basePath,
    api: options.api,
  });
  const auth = options.auth
    ? resolveAdminAuth(options.auth, base.api, base.basePath)
    : undefined;

  // User administration exists only behind auth: without a session there is nobody to be authorized,
  // and screens that mint accounts must never be the one part of the admin that answers to anyone.
  const users =
    options.auth && options.auth.users !== false
      ? (options.auth.users ?? options.auth.auth.users)
      : undefined;
  // `{basePath}/api/users`, not `{basePath}/users`: the latter is the Users *screen*, and the client
  // router owns every path under `basePath` that isn't a file — a data route there would answer the
  // browser's page request with JSON.
  const schema: AdminSchema = users
    ? { ...base, users: adminUsers(`${base.basePath}/api/users`) }
    : base;

  const chain: FallingHandler[] = [];
  // Setup goes ahead of the guard: it is the one route that must answer without a session, since it
  // is what creates the account every other route needs.
  if (auth?.setup) {
    chain.push(createAdminSetupHandler(auth.setup, options.auth?.setup?.token));
  }
  // The guard next, covering requests well outside `basePath` — it is what protects the REST routes
  // the admin edits through.
  if (auth) chain.push(createAdminGuard(auth));
  // Schema next: it sits under `basePath`, and the assets handler answers everything there, so
  // `schema.json` would come back as `index.html` if the order were reversed. The users routes go
  // in the same window, and for the same reason.
  chain.push(createAdminSchemaHandler(schema, auth));
  if (users && auth && schema.users) {
    chain.push(createAdminUsersHandler(users, auth, schema.users.path));
  }

  if (options.assets !== false) {
    const assets = options.assets ?? loadAdminAssets();
    chain.push(createAdminAssetsHandler(assets, { basePath: schema.basePath }));
  }

  return async function handleRequest(request) {
    for (const handler of chain) {
      const response = await handler(request);
      if (response) return response;
    }
    return undefined;
  };
}
