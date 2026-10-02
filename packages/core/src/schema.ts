import type { CollectionSchema } from "./collections/types.js";
import type { GlobalSchema } from "./globals/types.js";

/**
 * The full, validated schema of an app: every collection and global once plugins are merged.
 * What tools that look at the whole schema (such as `@shuri/migrate`) receive.
 */
export interface ResolvedSchema {
  collections: readonly CollectionSchema[];
  globals: readonly GlobalSchema[];
}
