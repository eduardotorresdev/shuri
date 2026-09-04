/**
 * A handler that answers a request or declines it by resolving to `undefined`, letting the next one
 * in the chain try — the contract every handler `createHandler` composes already follows.
 *
 * Its own leaf module on purpose: `handler.ts` imports `globals/handler.ts`, so a package that
 * needs this type (`@shuri/auth`, whose handler `createHandler` must not import) can take it from
 * here without an import cycle.
 */
export type FallingHandler = (request: Request) => Promise<Response | undefined>;
