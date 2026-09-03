import type { Field } from "../collections/fields.js";

/** Groups globals for display, e.g. in a future admin UI, keyed by `title`. */
export interface GlobalCategory {
  title: string;
}

export interface GlobalSchema {
  /** Stable identifier, unique across the whole app (same rule as `CollectionSchema.slug`). */
  slug: string;
  title: string;
  category: GlobalCategory;
  fields: readonly Field[];
}
