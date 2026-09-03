import type { StoreEvent } from "@shuri/store";
import type { EventSelection } from "./query.js";

/**
 * Decides whether an event belongs in a client's stream. An absent selector matches everything, so
 * a query string with no params streams every event. `collection`/`global` also select the scope:
 * `?collection=posts` leaves globals out, `?global=site` leaves collections out, and `?id=` leaves
 * globals out too (a global has no record id). `events` applies to both scopes alike.
 * @param event - The event to test.
 * @param selection - The client's selection, as parsed from the query string.
 * @returns Whether `event` matches `selection`.
 */
export function matchesSelection(event: StoreEvent, selection: EventSelection): boolean {
  if (selection.events && !selection.events.includes(event.type)) return false;

  // Discriminating a union this package's own `@shuri/store` built, not validating input.
  if (event.scope === "collection") {
    if (selection.collection && !selection.collection.includes(event.collection))
      return false;
    if (selection.id && !selection.id.includes(event.id)) return false;
    // A selection naming only globals is a selection of globals only.
    return Boolean(selection.collection ?? selection.id) || !selection.global;
  }

  if (selection.global) return selection.global.includes(event.global);
  return !selection.collection && !selection.id;
}
