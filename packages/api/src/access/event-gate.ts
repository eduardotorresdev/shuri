import {
  authorizeCollection,
  authorizeGlobal,
  type AccessContext,
  type AccessResult,
  type CollectionSchema,
  type GlobalSchema,
} from "@shuri/core";
import { matchesWhere, type Store } from "@shuri/store";
import type { StoreEvent } from "../realtime/event.js";
import type { EventSelection } from "../realtime/query.js";
import { deny } from "./principal.js";

/** Decides, for one connection, which events its principal may receive. */
export interface EventGate {
  /**
   * Refuses the connection up front when the client explicitly selected a slug its principal may
   * not read at all — a stream that would stay silent forever is the hardest failure to debug, and
   * a 401/403 at open time is the same answer the REST route gives.
   */
  assertSelectable(selection: EventSelection): Promise<void>;
  /** Whether one event, already redacted by `publicEvent`, may be sent to this connection. */
  admits(event: StoreEvent): Promise<boolean>;
}

/**
 * Builds the gate for one connection: the `list` rule of a collection (or `read` of a global) is
 * evaluated **once per slug** and cached for the connection's lifetime, since a stream can carry
 * thousands of events and a rule may hit the store. A `Where` is then checked per event against its
 * record; a `delete` event under a `Where` is **dropped** — it carries no pre-image to check, and
 * guessing would leak that the row existed.
 * @param store - The store resolving each slug's schema.
 * @param base - The connection's base context.
 * @returns The gate.
 */
export function createEventGate<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(store: Pick<Store<T, G>, "collection" | "global">, base: AccessContext): EventGate {
  const decisions = new Map<string, Promise<AccessResult>>();

  function decide(
    key: string,
    evaluate: () => Promise<AccessResult>,
  ): Promise<AccessResult> {
    let decision = decisions.get(key);
    if (!decision) {
      decision = evaluate();
      decisions.set(key, decision);
    }
    return decision;
  }

  const collectionDecision = (slug: string) =>
    decide(`collection:${slug}`, () =>
      authorizeCollection(store.collection(slug as never).schema, "list", base),
    );
  const globalDecision = (slug: string) =>
    decide(`global:${slug}`, () =>
      authorizeGlobal(store.global(slug as never).schema, "read", base),
    );

  return {
    async assertSelectable(selection) {
      for (const slug of selection.collection ?? []) {
        if ((await collectionDecision(slug)) === false) deny(base.principal);
      }
      for (const slug of selection.global ?? []) {
        if ((await globalDecision(slug)) === false) deny(base.principal);
      }
    },
    async admits(event) {
      if (event.scope === "global") return (await globalDecision(event.global)) === true;

      const result = await collectionDecision(event.collection);
      if (typeof result === "boolean") return result;
      if (event.type === "delete") return false;
      return matchesWhere(event.record, result);
    },
  };
}
