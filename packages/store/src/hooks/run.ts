/**
 * Runs the _before_ hooks of an operation in order, each awaited before the next. A hook that
 * returns a value replaces `args[key]` (the `data` of a write, the `query` of a list, the `doc` of
 * a read) for the hooks after it and for the operation; returning `undefined` keeps the current
 * one. A hook that throws aborts the chain, and with it the operation: the adapter is never touched.
 * @param hooks - The hooks to run, in order.
 * @param args - The arguments handed to the first hook.
 * @param key - The argument a hook's return value replaces.
 * @returns The final value of `args[key]`, after every hook had its say.
 */
export async function runBeforeHooks<A, K extends keyof A>(
  hooks: readonly ((args: A) => A[K] | void | Promise<A[K] | void>)[],
  args: A,
  key: K,
): Promise<A[K]> {
  let current = args;
  for (const hook of hooks) {
    const replacement = await hook(current);
    if (replacement !== undefined) current = { ...current, [key]: replacement };
  }
  return current[key];
}

/**
 * Runs hooks whose return value has nothing to replace (`afterChange`, `afterDelete`,
 * `beforeDelete`, `beforeRead` of a `get` or a global) in order, each awaited before the next. A throwing hook propagates to the caller:
 * for an _after_ hook the write has already happened, so a consumer that must never fail the
 * operation (the SSE feed, say) catches its own errors.
 * @param hooks - The hooks to run, in order.
 * @param args - The arguments handed to every hook.
 * @returns Nothing; resolves once every hook has run.
 */
export async function runAfterHooks<A>(
  hooks: readonly ((args: A) => unknown)[],
  args: A,
): Promise<void> {
  for (const hook of hooks) await hook(args);
}
