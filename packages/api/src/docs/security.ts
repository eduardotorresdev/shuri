import { scopeFor, type AccessOp } from "@shuri/core";

/** One entry of an operation's `security` list: scheme name -> scopes required from it. */
export type SecurityRequirement = Record<string, string[]>;

/**
 * How the document describes authentication. `schemes` lands in `components.securitySchemes`;
 * `requirements(scope)` is attached to every operation, with the `<slug>:<op>` scope guarding it
 * (so an OAuth2 scheme can list exactly what a client token needs) — or with none, for the event
 * stream, which is gated per event rather than per route.
 */
export interface OpenApiSecurity {
  schemes: Record<string, unknown>;
  requirements: (scope?: string) => SecurityRequirement[];
}

/**
 * The `security` and error responses of one guarded operation, or nothing when the document has no
 * security to describe — so a path builder can spread the result unconditionally.
 * @param security - The document's security, or `undefined` when access control is off.
 * @param slug - The collection or global slug.
 * @param op - The operation.
 * @returns The properties to spread into the operation object.
 */
export function guardedOperation(
  security: OpenApiSecurity | undefined,
  slug: string,
  op: AccessOp,
): Record<string, unknown> {
  if (!security) return {};
  return { security: security.requirements(scopeFor(slug, op)) };
}

/** The 401/403 responses every guarded operation may answer. */
export const GUARDED_RESPONSES = {
  "401": { description: "Not authenticated" },
  "403": { description: "Forbidden" },
} as const;
