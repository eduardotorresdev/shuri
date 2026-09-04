import type { GlobalSchema } from "@shuri/core";
import {
  UnknownGlobalError,
  type GlobalStore,
  type RecordInput,
  type Store,
} from "@shuri/store";

/** Test-only fixtures shared by this package's global unit tests, kept independent of `@shuri/sdk`/`@shuri/store-memory`. */
export const siteSettingsSchema: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

/**
 * In-memory `GlobalStore` test double bound to `schema`, carried like a real one so the
 * `visibility/` layer can read its `hidden` flags off it.
 * @param [schema] - The schema the fake store is bound to.
 * @returns A fake `GlobalStore` over one in-memory record.
 */
export function createFakeGlobalStore(
  schema: GlobalSchema = siteSettingsSchema,
): GlobalStore<RecordInput> {
  let record: RecordInput = {};

  return {
    schema,
    subscribe: () => () => {},
    async get() {
      return record;
    },
    async update(data) {
      record = { ...record, ...data };
      return record;
    },
  };
}

/**
 * Fake `{ store }` exposing a single "site" global, for handler-level unit tests.
 * @param [global] - The global store returned for the "site" slug.
 * @returns A fake `{ store }` exposing `global` under the "site" slug.
 */
export function createFakeGlobalsApp(
  global: GlobalStore<RecordInput> = createFakeGlobalStore(),
): { store: Store } {
  const store = {
    global: (slug: string) => {
      if (slug !== global.schema.slug) throw new UnknownGlobalError(slug);
      return global;
    },
  } as unknown as Store;
  return { store };
}
