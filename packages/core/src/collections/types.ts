import type { Field } from "./fields.js";

export interface CollectionSchema {
  /** Stable identifier, used by relation fields to reference this collection. */
  slug: string;
  title: string;
  singular: string;
  plural: string;
  /** Whether records in this collection can be manually reordered in a list. */
  orderable?: boolean;
  fields: Field[];
}
