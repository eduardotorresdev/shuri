import { toClientError } from "../errors.js";
import type { Http } from "../http.js";
import { parseEventStream } from "./sse.js";

/** The `event:` names the stream carries — the server's `STORE_EVENT_TYPES`. */
export type EventType = "create" | "update" | "delete";

/** Which events to receive; every selector is optional and an absent one matches everything. */
export interface EventSelection {
  collection?: string[];
  global?: string[];
  id?: string[];
  events?: EventType[];
}

/** One frame as decoded off the stream: the `event:` name plus the parsed `data:` payload. */
export interface RealtimeMessage {
  type: EventType;
  [field: string]: unknown;
}

export interface SubscribeOptions {
  /** Aborting it ends the subscription, same as calling the returned function. */
  signal?: AbortSignal;
  /** Called with every error: a refused stream (a `ClientError`), a dropped connection, a bad frame. */
  onError?: (error: unknown) => void;
  /** Called each time a stream is (re)opened. */
  onOpen?: () => void;
  /** First reconnect delay in milliseconds, doubled per attempt up to `maxRetryDelayMs`. Defaults to 1000. */
  retryDelayMs?: number;
  /** Cap on the reconnect delay. Defaults to 30000. */
  maxRetryDelayMs?: number;
}

/** Ends a subscription. */
export type Unsubscribe = () => void;

/**
 * Opens the event stream (`GET {path}?collection=…&global=…&id=…&events=…`) and calls `listener`
 * per frame until unsubscribed. The connection is re-opened with a capped exponential backoff when
 * it drops or the server closes it; a 4xx is final (the selection is wrong, or the principal may
 * not read it), reported through `onError` with no retry, while a 5xx retries like a drop.
 *
 * `fetch` rather than `EventSource` on purpose: `EventSource` can't send an `Authorization` header,
 * and a client authenticating with a bearer token (a Node script, a mobile app) needs exactly that.
 * @param http - The HTTP seam, carrying the base URL, credentials and bearer token.
 * @param path - The stream's path, `/events` by default.
 * @param selection - Which events to receive.
 * @param listener - Receives one decoded frame at a time.
 * @param [options] - Abort signal, error/open callbacks and the retry policy.
 * @returns The unsubscribe function.
 */
export function subscribe(
  http: Http,
  path: string,
  selection: EventSelection,
  listener: (message: RealtimeMessage) => void,
  options: SubscribeOptions = {},
): Unsubscribe {
  const controller = new AbortController();
  const { signal } = controller;
  const stop = () => controller.abort();
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener("abort", stop, { once: true });

  const retryDelayMs = options.retryDelayMs ?? 1000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
  const query = toEventParams(selection);

  const onFrame = (event: string, data: string): void => {
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      listener({ ...payload, type: event as EventType });
    } catch (error) {
      options.onError?.(error);
    }
  };

  async function run(): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const response = await http.send("GET", path, {
          query,
          headers: { accept: "text/event-stream" },
          signal,
        });
        if (!response.ok) {
          const error = await toClientError(response);
          options.onError?.(error);
          if (response.status < 500) return;
          throw error;
        }
        if (!response.body) throw new Error("The event stream has no body");
        attempt = 0;
        options.onOpen?.();
        await parseEventStream(response.body, ({ event, data }) => onFrame(event, data));
      } catch (error) {
        if (signal.aborted) return;
        options.onError?.(error);
      }
      if (signal.aborted) return;
      await delay(Math.min(retryDelayMs * 2 ** attempt, maxRetryDelayMs), signal);
      attempt += 1;
    }
  }

  void run();
  return stop;
}

/**
 * Serializes a selection the way the server's `parseEventQuery` reads it: one param per entry.
 * @param selection - The selection to serialize.
 * @returns The search params.
 */
export function toEventParams(selection: EventSelection): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["collection", "global", "id", "events"] as const) {
    for (const value of selection[key] ?? []) params.append(key, value);
  }
  return params;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
