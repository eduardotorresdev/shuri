import type { StoreEvent } from "@shuri/store";

/**
 * Formats one event as an SSE message: `type` becomes the `event:` line and the rest of the event
 * becomes the `data:` payload, minus `scope` (a server-side dispatch discriminant). `JSON.stringify`
 * escapes newlines, so the payload always fits the single `data:` line SSE requires.
 *
 * There is deliberately no `id:` line: `id`/`Last-Event-ID` promise resumption, and an in-process
 * bus keeps no history to resume from. A record's own id travels inside `data`.
 * @param event - The event to format.
 * @returns The SSE frame, terminating blank line included.
 */
export function toEventFrame(event: StoreEvent): string {
  const { scope: _scope, type, ...data } = event;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
