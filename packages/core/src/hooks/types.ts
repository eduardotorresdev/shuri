import type { Principal } from "../access/types.js";
import type { Prettify } from "../collections/infer.js";
import type { Query } from "../collections/query.js";

/** The hook names a collection declares, in the order they run across one write/read/delete. */
export const COLLECTION_HOOK_NAMES = [
  "beforeValidate",
  "beforeChange",
  "afterChange",
  "beforeRead",
  "afterRead",
  "beforeDelete",
  "afterDelete",
] as const;

/** The hook names a global declares: the collection set without delete, which a global has no notion of. */
export const GLOBAL_HOOK_NAMES = [
  "beforeValidate",
  "beforeChange",
  "afterChange",
  "beforeRead",
  "afterRead",
] as const;

export type CollectionHookName = (typeof COLLECTION_HOOK_NAMES)[number];
export type GlobalHookName = (typeof GLOBAL_HOOK_NAMES)[number];

/**
 * What the caller of an operation attaches for hooks to see. `@shuri/api` fills in the `request`
 * and, with access control on, the `principal` behind it; a call through the SDK/store carries an
 * empty context, so a hook reading `context.request` must expect `undefined`.
 */
export interface OperationContext {
  request?: Request;
  principal?: Principal;
}

/** The generic record shape hooks see when the schema isn't statically known; the SDK narrows it per slug. */
export type HookRecord = Record<string, unknown>;

/** A persisted record: the declared shape plus the id the store assigned. */
export type WithId<R> = Prettify<R & { id: string }>;

type MaybePromise<T> = T | Promise<T>;

interface CollectionHookArgs {
  /** The slug of the collection the operation runs on, useful for a hook registered on `"*"`. */
  collection: string;
  context: OperationContext;
}

/**
 * `beforeValidate` and `beforeChange` share these arguments: the write's `data`, plus the pre-image
 * and id for an update. `beforeValidate` runs before field validation (so it may fill in or coerce
 * what validation will then check), `beforeChange` after it. Either may return a replacement
 * `data`; returning nothing keeps the current one.
 */
export type CollectionBeforeChangeArgs<R = HookRecord> = CollectionHookArgs &
  (
    | { operation: "create"; data: R; originalDoc?: undefined; id?: undefined }
    | { operation: "update"; data: Partial<R>; originalDoc: WithId<R>; id: string }
  );

export type CollectionBeforeChangeHook<R = HookRecord> = (
  args: CollectionBeforeChangeArgs<R>,
) => MaybePromise<Partial<R> | void>;

/** Runs after the adapter persisted the write: `doc` is what was stored, `previousDoc` the pre-image of an update. */
export type CollectionAfterChangeArgs<R = HookRecord> = CollectionHookArgs &
  (
    | { operation: "create"; doc: WithId<R>; previousDoc?: undefined }
    | { operation: "update"; doc: WithId<R>; previousDoc: WithId<R> }
  );

export type CollectionAfterChangeHook<R = HookRecord> = (
  args: CollectionAfterChangeArgs<R>,
) => MaybePromise<void>;

/**
 * Runs once per read operation, before the adapter. For a `list` it may return a replacement
 * `query` (the way an access rule narrows one); for a `get` there is nothing to replace.
 */
export type CollectionBeforeReadArgs = CollectionHookArgs &
  (
    | { operation: "list"; query?: Query; id?: undefined }
    | { operation: "get"; id: string; query?: undefined }
  );

export type CollectionBeforeReadHook = (
  args: CollectionBeforeReadArgs,
) => MaybePromise<Query | void>;

/** Runs once per record a read returns; may return a replacement `doc` (a computed field, a redaction). */
export interface CollectionAfterReadArgs<R = HookRecord> extends CollectionHookArgs {
  operation: "list" | "get";
  doc: WithId<R>;
  query?: Query;
}

export type CollectionAfterReadHook<R = HookRecord> = (
  args: CollectionAfterReadArgs<R>,
) => MaybePromise<WithId<R> | void>;

/** `doc` is the record about to be (or just) deleted, `undefined` when the id matched nothing. */
export interface CollectionDeleteArgs<R = HookRecord> extends CollectionHookArgs {
  id: string;
  doc?: WithId<R>;
}

export type CollectionDeleteHook<R = HookRecord> = (
  args: CollectionDeleteArgs<R>,
) => MaybePromise<void>;

/**
 * Every hook a collection may declare, keyed by name, each an array run in declaration order —
 * Payload CMS's vocabulary. A hook declared on the schema runs before one registered through the
 * store's registry (`app.hooks.onCollection(...)`).
 */
export interface CollectionHooks<R = HookRecord> {
  beforeValidate?: CollectionBeforeChangeHook<R>[];
  beforeChange?: CollectionBeforeChangeHook<R>[];
  afterChange?: CollectionAfterChangeHook<R>[];
  beforeRead?: CollectionBeforeReadHook[];
  afterRead?: CollectionAfterReadHook<R>[];
  beforeDelete?: CollectionDeleteHook<R>[];
  afterDelete?: CollectionDeleteHook<R>[];
}

/** The hook function type for one collection hook name, e.g. `CollectionHook<"afterChange">`. */
export type CollectionHook<N extends CollectionHookName, R = HookRecord> = NonNullable<
  CollectionHooks<R>[N]
>[number];

interface GlobalHookArgs {
  /** The slug of the global the operation runs on, useful for a hook registered on `"*"`. */
  global: string;
  context: OperationContext;
}

/** A global is always updated (never created), so `originalDoc` is always there — `{}` before the first update. */
export interface GlobalBeforeChangeArgs<R = HookRecord> extends GlobalHookArgs {
  data: Partial<R>;
  originalDoc: R;
}

export type GlobalBeforeChangeHook<R = HookRecord> = (
  args: GlobalBeforeChangeArgs<R>,
) => MaybePromise<Partial<R> | void>;

export interface GlobalAfterChangeArgs<R = HookRecord> extends GlobalHookArgs {
  doc: R;
  previousDoc: R;
}

export type GlobalAfterChangeHook<R = HookRecord> = (
  args: GlobalAfterChangeArgs<R>,
) => MaybePromise<void>;

export type GlobalBeforeReadArgs = GlobalHookArgs;

export type GlobalBeforeReadHook = (args: GlobalBeforeReadArgs) => MaybePromise<void>;

export interface GlobalAfterReadArgs<R = HookRecord> extends GlobalHookArgs {
  doc: R;
}

export type GlobalAfterReadHook<R = HookRecord> = (
  args: GlobalAfterReadArgs<R>,
) => MaybePromise<R | void>;

/** Every hook a global may declare; same rules as `CollectionHooks`, minus the delete pair. */
export interface GlobalHooks<R = HookRecord> {
  beforeValidate?: GlobalBeforeChangeHook<R>[];
  beforeChange?: GlobalBeforeChangeHook<R>[];
  afterChange?: GlobalAfterChangeHook<R>[];
  beforeRead?: GlobalBeforeReadHook[];
  afterRead?: GlobalAfterReadHook<R>[];
}

/** The hook function type for one global hook name, e.g. `GlobalHook<"afterRead">`. */
export type GlobalHook<N extends GlobalHookName, R = HookRecord> = NonNullable<
  GlobalHooks<R>[N]
>[number];
