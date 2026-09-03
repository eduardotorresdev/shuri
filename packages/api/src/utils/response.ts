import {
  RecordNotFoundError,
  RecordValidationError,
  UnknownCollectionError,
  UnknownGlobalError,
} from "@shuri/store";
import { ApiError, IssuesApiError } from "../errors.js";

function jsonHeaders(extra?: NonNullable<ResponseInit["headers"]>): Headers {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  return headers;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: jsonHeaders(init.headers),
  });
}

export function errorResponse(
  status: number,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse({ error: message, ...details }, { status });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Maps an error caught while handling a request to an HTTP `Response`. Errors this package
 * recognizes map to their own status; the rest are rethrown so they surface as a 500 (or crash)
 * at the hosting engine's own error boundary.
 * @param error - The error caught while handling a request.
 * @returns The HTTP `Response` mapped from `error`.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof IssuesApiError)
    return errorResponse(error.status, error.message, { issues: error.issues });
  if (error instanceof ApiError) return errorResponse(error.status, error.message);
  if (error instanceof UnknownCollectionError) return errorResponse(404, error.message);
  if (error instanceof UnknownGlobalError) return errorResponse(404, error.message);
  if (error instanceof RecordNotFoundError) return errorResponse(404, error.message);
  if (error instanceof RecordValidationError)
    return errorResponse(400, error.message, { issues: error.issues });
  throw error;
}

/** Writes one already-formatted SSE frame to the open stream. Ignored once the stream is closed. */
export type SendEvent = (frame: string) => void;

/** Stops producing frames for a stream that is being closed — typically an unsubscribe function. */
export type EventStreamTeardown = () => void;

export interface EventStreamOptions {
  /** Aborted by the host when the client disconnects; closes the stream and runs the teardown. */
  signal?: AbortSignal;
  /** Milliseconds between keep-alive comments. `0` disables them. Defaults to 15000. */
  heartbeatMs?: number;
}

const HEARTBEAT_FRAME = ": keep-alive\n\n";

/**
 * Opens a `text/event-stream` response fed by `start`, which receives the `send` function and
 * returns the teardown to run when the stream ends. `start` runs synchronously inside the
 * `ReadableStream` constructor, so whatever it subscribes to is already live by the time this
 * function returns — no window in which an event could be missed.
 *
 * The stream ends through either of two paths, and both must be handled: the host aborting `signal`
 * (client disconnected) and the consumer cancelling the stream. Handling only one leaks the
 * subscription and the heartbeat interval per connection. Closing runs the teardown exactly once,
 * and `controller.close()` is skipped after a cancel, where it would throw.
 *
 * Idle connections are kept alive with a comment frame every `heartbeatMs`, since proxies and load
 * balancers drop a silent connection after 30-60s and a dead socket only surfaces on write.
 * @param start - Subscribes to whatever produces frames, and returns the teardown for it.
 * @param [options] - Options controlling the stream, e.g. `signal`/`heartbeatMs`.
 * @returns The streaming `text/event-stream` response.
 */
export function eventStreamResponse(
  start: (send: SendEvent) => EventStreamTeardown,
  options: EventStreamOptions = {},
): Response {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  // Assigned by `start` (which runs synchronously below) and read by `cancel`.
  let teardown: EventStreamTeardown | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      const send: SendEvent = (frame) => {
        if (!stopped) controller.enqueue(encoder.encode(frame));
      };

      const unsubscribe = start(send);
      const heartbeat =
        heartbeatMs > 0
          ? setInterval(() => send(HEARTBEAT_FRAME), heartbeatMs)
          : undefined;

      teardown = () => {
        if (stopped) return;
        stopped = true;
        if (heartbeat !== undefined) clearInterval(heartbeat);
        unsubscribe();
      };
      const close = () => {
        if (stopped) return;
        teardown?.();
        controller.close();
      };

      if (options.signal?.aborted) close();
      else options.signal?.addEventListener("abort", close, { once: true });
    },
    cancel() {
      teardown?.();
    },
  });

  return new Response(stream, { headers: eventStreamHeaders() });
}

function eventStreamHeaders(): Headers {
  return new Headers({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Proxies buffer responses by default, which would hold every frame back and defeat streaming.
    "x-accel-buffering": "no",
  });
}
