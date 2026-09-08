import type { Where } from "../collections/query.js";

/** The operations a collection's `access` can rule on, one per REST route. */
export const COLLECTION_ACCESS_OPS = [
  "create",
  "list",
  "view",
  "update",
  "delete",
] as const;
/** The operations a global's `access` can rule on. */
export const GLOBAL_ACCESS_OPS = ["read", "update"] as const;

export type CollectionAccessOp = (typeof COLLECTION_ACCESS_OPS)[number];
export type GlobalAccessOp = (typeof GLOBAL_ACCESS_OPS)[number];
export type AccessOp = CollectionAccessOp | GlobalAccessOp;

/** The signed-in user an access rule sees: its id plus whatever public fields the auth layer exposes. */
export interface AccessUser {
  id: string;
  [field: string]: unknown;
}

/** The machine client behind a client-credentials token. */
export interface AccessClient {
  id: string;
  name: string;
  [field: string]: unknown;
}

/**
 * Who is making the request. A user has no scopes: like Payload CMS, any signed-in user may do
 * anything a rule doesn't forbid. A client carries the scopes its token was issued with, and those
 * are the ceiling of what it may do; a rule can only narrow further.
 */
export type Principal =
  | { kind: "anonymous" }
  | { kind: "user"; user: AccessUser }
  | { kind: "client"; client: AccessClient; scopes: ReadonlySet<string> };

/** What an access rule receives. `user`/`client` are shortcuts into `principal`, present per its `kind`. */
export interface AccessContext {
  principal: Principal;
  user?: AccessUser;
  client?: AccessClient;
  request?: Request;
  /** The record addressed, for `view`/`update`/`delete`. */
  id?: string;
  /** The payload, for `create`/`update`. */
  data?: Record<string, unknown>;
}

/**
 * A rule's answer: `true`/`false`, or a `Where` restricting *which rows* the operation applies to —
 * merged into a list query, and checked against the record for `view`/`update`/`delete`.
 */
export type AccessResult = boolean | Where;

export type AccessRuleFn = (ctx: AccessContext) => AccessResult | Promise<AccessResult>;

export type AccessRule = boolean | AccessRuleFn;

export type CollectionAccess = Partial<Record<CollectionAccessOp, AccessRule>>;

export type GlobalAccess = Partial<Record<GlobalAccessOp, AccessRule>>;
