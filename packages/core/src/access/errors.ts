/**
 * An access rule answered with a `Where` for an operation that has no rows to filter — `create` on
 * a collection, or anything on a global. Failing closed *and* loudly: silently treating the `Where`
 * as `true` would grant what the rule meant to restrict, and treating it as `false` would hide a
 * config bug behind a 403 nobody investigates.
 */
export class AccessRuleError extends Error {
  constructor(
    public readonly slug: string,
    public readonly op: string,
  ) {
    super(
      `The "${op}" access rule of "${slug}" returned a Where, but "${op}" has no rows to filter — return a boolean`,
    );
    this.name = "AccessRuleError";
  }
}
