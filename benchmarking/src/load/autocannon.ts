import autocannon from "autocannon";
import { startSampling, type StatsSummary } from "./stats.ts";

export type CannonRequest = autocannon.Request;

/** One autocannon measurement, normalized to the handful of numbers the report shows. */
export interface LoadResult {
  /** Requests completed during the measurement. */
  requests: number;
  /** Mean requests per second over the measurement. */
  rps: number;
  p50: number;
  p99: number;
  max: number;
  /** Connection errors, timeouts included. */
  errors: number;
  timeouts: number;
  non2xx: number;
  bytesPerSec: number;
  durationS: number;
}

export interface CannonOptions {
  /** The SUT's origin; each request's `path` is resolved against it. */
  url: string;
  connections: number;
  /** Seconds. */
  duration: number;
  /** The request mix, cycled per connection. Defaults to a single `GET /`. */
  requests?: CannonRequest[];
  title?: string;
  /** Seconds before a request counts as a timeout. Defaults to 10. */
  timeout?: number;
}

/**
 * One raw autocannon run — no warmup, no stats. The building block `runLoad` and the custom
 * scenarios (`sse-fanout`, `login-noise`) compose.
 * @param options - What to fire, at what concurrency, for how long.
 * @returns The normalized result.
 */
export async function cannon(options: CannonOptions): Promise<LoadResult> {
  const result = await autocannon({
    url: options.url,
    connections: options.connections,
    duration: options.duration,
    requests: options.requests ?? [{ method: "GET", path: "/" }],
    title: options.title,
    timeout: options.timeout ?? 10,
  });
  return normalize(result);
}

/**
 * The full measurement for one HTTP scenario at one concurrency: a warmup run whose numbers are
 * thrown away (JIT, TCP slow start, the first GC cycles), then the measured run with the SUT's
 * memory and event loop sampled once a second alongside it.
 * @param options - The load, plus `warmup` seconds and the SUT's `statsUrl`.
 * @returns The load result and the stats sampled during it.
 */
export async function runLoad(
  options: CannonOptions & { warmup: number; statsUrl: string },
): Promise<{ load: LoadResult; stats: StatsSummary }> {
  if (options.warmup > 0) await cannon({ ...options, duration: options.warmup });
  const sampler = startSampling(options.statsUrl);
  const load = await cannon(options);
  const stats = await sampler.stop();
  return { load, stats };
}

/**
 * Projects autocannon's result onto `LoadResult`.
 * @param result - autocannon's aggregate.
 * @returns The normalized result.
 */
export function normalize(result: autocannon.Result): LoadResult {
  return {
    requests: result.requests.total,
    rps: result.requests.average,
    p50: result.latency.p50,
    p99: result.latency.p99,
    max: result.latency.max,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    bytesPerSec: result.throughput.average,
    durationS: result.duration,
  };
}

/**
 * A `setupRequest` that walks `ids` round-robin, so a read scenario touches the table rather than
 * one hot record. The counter is shared across connections on purpose: every request lands on a
 * different id than the previous one.
 * @param ids - The ids to rotate through.
 * @param path - Builds the request path for one id.
 * @returns The `setupRequest` hook.
 */
export function rotateIds(
  ids: readonly string[],
  path: (id: string) => string,
): (request: CannonRequest) => CannonRequest {
  let i = 0;
  return (request) => {
    request.path = path(ids[i++ % ids.length] as string);
    return request;
  };
}
