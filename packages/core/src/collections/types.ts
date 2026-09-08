import type { CollectionAccess } from "../access/types.js";
import type { CollectionHooks } from "../hooks/types.js";
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
  /**
   * Per-operation access rules (`create`/`list`/`view`/`update`/`delete`), applied by `@shuri/api`
   * when the host turned auth on. An op with no rule is allowed to any signed-in user and denied to
   * an anonymous request; a rule may answer with a `Where` to restrict which rows the op reaches.
   * See `access/policy.ts` for the full policy, clients and scopes included.
   */
  access?: CollectionAccess;
  /**
   * Lifecycle hooks (`beforeValidate`/`beforeChange`/`afterChange`/`beforeRead`/`afterRead`/
   * `beforeDelete`/`afterDelete`), Payload CMS style, run by `@shuri/store` around every operation
   * whichever surface it came through. Declared here they run before any hook registered at runtime
   * through `app.hooks`. See `hooks/types.ts` for what each one receives and may return.
   */
  hooks?: CollectionHooks;
  fields: readonly Field[];
}
