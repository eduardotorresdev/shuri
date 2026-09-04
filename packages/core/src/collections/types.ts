import type { Field } from "./fields.js";

export interface CollectionSchema {
  /** Stable identifier, used by relation fields to reference this collection. */
  slug: string;
  title: string;
  singular: string;
  plural: string;
  /** Whether records in this collection can be manually reordered in a list. */
  orderable?: boolean;
  /**
   * Keeps the whole collection off the HTTP surface: `@shuri/api` answers a request for it exactly
   * as it would for a slug no collection declares, leaves it out of the OpenAPI document, and drops
   * its events before they reach the SSE stream. Programmatic access through `@shuri/store` is
   * unaffected, and the collection still appears in `InferCollections`.
   */
  internal?: boolean;
  fields: readonly Field[];
}
