import type { GlobalAccess } from "../access/types.js";
import type { Field } from "../collections/fields.js";
import type { GlobalHooks } from "../hooks/types.js";

/** Groups globals for display, e.g. in a future admin UI, keyed by `title`. */
export interface GlobalCategory {
  title: string;
}

export interface GlobalSchema {
  /** Stable identifier, unique across the whole app (same rule as `CollectionSchema.slug`). */
  slug: string;
  title: string;
  category: GlobalCategory;
  /** Per-operation access rules (`read`/`update`); booleans only, a global has no rows to filter. See `access/policy.ts`. */
  access?: GlobalAccess;
  /** Lifecycle hooks (`beforeValidate`/`beforeChange`/`afterChange`/`beforeRead`/`afterRead`); see `CollectionSchema.hooks`. */
  hooks?: GlobalHooks;
  fields: readonly Field[];
}
