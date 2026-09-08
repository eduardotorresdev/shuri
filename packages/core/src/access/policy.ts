import type { CollectionSchema } from "../collections/types.js";
import type { GlobalSchema } from "../globals/types.js";
import { AccessRuleError } from "./errors.js";
import { scopeFor } from "./scopes.js";
import type {
  AccessContext,
  AccessOp,
  AccessResult,
  AccessRule,
  CollectionAccessOp,
  GlobalAccessOp,
} from "./types.js";

/** The collection ops whose rule may answer with a `Where`: every one that addresses existing rows. */
const ROW_OPS: ReadonlySet<AccessOp> = new Set(["list", "view", "update", "delete"]);

/**
 * Normalizes a rule — a constant or a function, sync or async — into its answer.
 * @param rule - The declared rule.
 * @param ctx - The context the rule sees.
 * @returns The rule's answer.
 */
export async function evaluateRule(
  rule: AccessRule,
  ctx: AccessContext,
): Promise<AccessResult> {
  return typeof rule === "function" ? rule(ctx) : rule;
}

/**
 * What a schema needs to declare for `authorize` to rule on it: its slug (for the scope) and its
 * `access` map. Both `CollectionSchema` and `GlobalSchema` satisfy it structurally.
 */
export interface AccessTarget<Op extends AccessOp> {
  slug: string;
  access?: Partial<Record<Op, AccessRule>>;
}

/**
 * The policy, in one place:
 *
 * | principal | no rule for `op`        | rule declared                               |
 * | --------- | ----------------------- | ------------------------------------------- |
 * | anonymous | denied                  | the rule decides (`user` is `undefined`)    |
 * | user      | allowed                 | the rule decides                            |
 * | client    | needs scope `<slug>:op` | needs the scope **and** the rule must allow |
 *
 * A client's scope is a ceiling the rule can only lower: a public rule (`list: () => true`) doesn't
 * spare a client the scope, because a client is provisioned explicitly and gets exactly what it was
 * granted. `allowsWhere` says whether `op` addresses rows a `Where` could filter; when it doesn't, a
 * rule answering with one is a bug and throws `AccessRuleError`.
 * @param target - The collection or global being accessed.
 * @param op - The operation.
 * @param ctx - Who is asking, and with what.
 * @param allowsWhere - Whether a `Where` is a valid answer for `op`.
 * @returns `true`, `false`, or the `Where` restricting the rows `op` applies to.
 */
export async function authorize<Op extends AccessOp>(
  target: AccessTarget<Op>,
  op: Op,
  ctx: AccessContext,
  allowsWhere: boolean,
): Promise<AccessResult> {
  const { principal } = ctx;
  if (principal.kind === "client" && !principal.scopes.has(scopeFor(target.slug, op))) {
    return false;
  }

  const rule = target.access?.[op];
  if (rule === undefined) return principal.kind !== "anonymous";

  const result = await evaluateRule(rule, ctx);
  if (typeof result !== "boolean" && !allowsWhere) {
    throw new AccessRuleError(target.slug, op);
  }
  return result;
}

/**
 * `authorize` for a collection: `list`/`view`/`update`/`delete` may answer with a `Where`, `create`
 * may not — there is no row yet to filter.
 * @param collection - The collection being accessed.
 * @param op - The operation.
 * @param ctx - Who is asking, and with what.
 * @returns The authorization result.
 */
export function authorizeCollection(
  collection: Pick<CollectionSchema, "slug" | "access">,
  op: CollectionAccessOp,
  ctx: AccessContext,
): Promise<AccessResult> {
  return authorize(collection, op, ctx, ROW_OPS.has(op));
}

/**
 * `authorize` for a global: a global is one record, so a rule may only answer with a boolean.
 * @param global - The global being accessed.
 * @param op - The operation.
 * @param ctx - Who is asking, and with what.
 * @returns The authorization result, always a boolean.
 */
export async function authorizeGlobal(
  global: Pick<GlobalSchema, "slug" | "access">,
  op: GlobalAccessOp,
  ctx: AccessContext,
): Promise<boolean> {
  return (await authorize(global, op, ctx, false)) as boolean;
}
