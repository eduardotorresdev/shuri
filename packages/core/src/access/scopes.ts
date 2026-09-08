import { servableCollections } from "../collections/redact.js";
import type { CollectionSchema } from "../collections/types.js";
import type { GlobalSchema } from "../globals/types.js";
import { COLLECTION_ACCESS_OPS, GLOBAL_ACCESS_OPS, type AccessOp } from "./types.js";

/**
 * The shape of a scope or a scope pattern: `posts:list`, `posts:*`, `*:list` or `*`. Slugs are kept
 * to URL-safe characters since a scope travels in an OAuth2 `scope` parameter, space-separated.
 */
export const SCOPE_PATTERN = /^(?:\*|(?:[A-Za-z0-9_-]+|\*):(?:[a-z]+|\*))$/;

/**
 * The scope guarding one operation of one collection or global, e.g. `posts:list`, `site:update`.
 * @param slug - The collection or global slug.
 * @param op - The operation.
 * @returns The scope name.
 */
export function scopeFor(slug: string, op: AccessOp): string {
  return `${slug}:${op}`;
}

/**
 * Every concrete scope a schema gives rise to: one per operation of every served collection and of
 * every global. `internal` collections produce none — they are off HTTP, so there is nothing a
 * client could be granted on them.
 * @param collections - Every declared collection.
 * @param globals - Every declared global.
 * @returns The scope universe, in declaration order.
 */
export function derivedScopes(
  collections: readonly CollectionSchema[],
  globals: readonly GlobalSchema[],
): string[] {
  const scopes: string[] = [];
  for (const collection of servableCollections(collections)) {
    for (const op of COLLECTION_ACCESS_OPS) scopes.push(scopeFor(collection.slug, op));
  }
  for (const global of globals) {
    for (const op of GLOBAL_ACCESS_OPS) scopes.push(scopeFor(global.slug, op));
  }
  return scopes;
}

function matchesPattern(pattern: string, scope: string): boolean {
  if (pattern === "*") return true;
  const [slugPattern, opPattern] = pattern.split(":");
  const [slug, op] = scope.split(":");
  return (
    (slugPattern === "*" || slugPattern === slug) &&
    (opPattern === "*" || opPattern === op)
  );
}

/**
 * Expands scope patterns into the concrete scopes of `universe` they cover. This is where a role
 * (`integrator: ["posts:*"]`) becomes the exact set a token carries — done once at issuance, so a
 * request only ever asks `has()`. A pattern matching nothing expands to nothing, on purpose: a
 * token can't be granted a scope the schema doesn't define.
 * @param patterns - Scope patterns: `*`, `posts:*`, `*:list` or a literal scope.
 * @param universe - The concrete scopes that exist, from `derivedScopes`.
 * @returns The matched scopes, in `universe` order.
 */
export function expandScopes(
  patterns: readonly string[],
  universe: readonly string[],
): Set<string> {
  const expanded = new Set<string>();
  for (const scope of universe) {
    if (patterns.some((pattern) => matchesPattern(pattern, scope))) expanded.add(scope);
  }
  return expanded;
}
