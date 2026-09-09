import type { CollectionStore, RecordInput } from "@shuri/store";
import type { AdminSetupCredentials, AdminSetupSource } from "@shuri/ui";
import type { BetterAuthHandler } from "./handler.js";

/** better-auth's own signup route, relative to its base path. */
const SIGN_UP = "/sign-up/email";

export interface BetterAuthSetupOptions {
  /**
   * Applied to the account right after it is created — the place to stamp whatever `authorize`
   * reads, e.g. `{ role: "admin" }`.
   *
   * **The column must be one better-auth knows about**, through `user.additionalFields` or a plugin
   * that declares it. better-auth parses a user against its own schema on the way out, so a column
   * written here but undeclared there is stored and then silently dropped before it ever reaches a
   * session — and `authorize` would never see it. Declaring it also puts it on the collection
   * `betterAuthCollections` derives, so the store validates it too.
   *
   * Written to the store rather than passed to signup because better-auth's signup accepts only the
   * fields it was configured to take as input.
   */
  fields?: RecordInput;
  /** The `user` table's slug, when the host renamed it. Defaults to "user". */
  userModel?: string;
}

/**
 * The slice of `@shuri/store` this needs: reading the user table to see whether it is empty, and
 * updating the row setup just created.
 */
export interface SetupCollectionResolver {
  collection(slug: string): CollectionStore<RecordInput>;
}

/**
 * A first-run source for `@shuri/ui`'s setup flow, backed by better-auth.
 *
 * `required()` is "the user table is empty", which is the property that actually matters: it is true
 * exactly once in an app's life and goes false the instant an account exists — including one created
 * by any other route. Nothing has to remember that setup ran.
 *
 * `create()` forwards to better-auth's own signup route rather than reaching into the store, so the
 * password goes through better-auth's hasher and the response comes back carrying the session cookie
 * the browser needs. Whoever completes setup ends up signed in.
 * @param auth - The better-auth instance, for its signup route.
 * @param store - The store holding better-auth's tables.
 * @param basePath - Where better-auth's routes are mounted.
 * @param [options] - Extra fields to stamp on the new account, and the user table's slug.
 * @returns The setup source to hand `createAdminHandler`.
 */
export function createBetterAuthSetup(
  auth: BetterAuthHandler,
  store: SetupCollectionResolver,
  basePath: string,
  options: BetterAuthSetupOptions = {},
): AdminSetupSource {
  const userModel = options.userModel ?? "user";

  return {
    async required() {
      return (await store.collection(userModel).count()) === 0;
    },

    async create(credentials: AdminSetupCredentials, request: Request) {
      const url = new URL(request.url);
      const response = await auth.handler(
        new Request(`${url.origin}${basePath}${SIGN_UP}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // better-auth refuses a state-changing request with no Origin; this one is synthesised
            // from the request it is answering, which the browser already sent an Origin for.
            origin: request.headers.get("origin") ?? url.origin,
          },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
            name: credentials.name ?? credentials.email,
          }),
        }),
      );

      if (response.ok && options.fields)
        await stampFields(store, userModel, credentials.email, options.fields);
      return response;
    },
  };
}

/**
 * Writes the host's extra fields onto the account setup just created.
 *
 * Looked up by email rather than read off the signup response, because the response body is
 * better-auth's to shape and a plugin may change it; the email is what the caller supplied.
 * @param store - The store holding the user table.
 * @param userModel - The user table's slug.
 * @param email - The address the account was created with.
 * @param fields - The fields to write.
 */
async function stampFields(
  store: SetupCollectionResolver,
  userModel: string,
  email: string,
  fields: RecordInput,
): Promise<void> {
  const [created] = await store
    .collection(userModel)
    .findMany({ where: { email: { op: "eq", value: email } }, limit: 1 });
  if (created) await store.collection(userModel).update(created.id, fields);
}
