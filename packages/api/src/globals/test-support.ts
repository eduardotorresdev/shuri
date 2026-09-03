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

export function createFakeGlobalStore(): GlobalStore<RecordInput> {
  let record: RecordInput = {};

  return {
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
      if (slug !== "site") throw new UnknownGlobalError(slug);
      return global;
    },
  } as unknown as Store;
  return { store };
}
