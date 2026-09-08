import http from "node:http";
import { cannon, type CannonRequest } from "../autocannon.ts";
import { startSampling } from "../stats.ts";
import type { Scenario } from "./index.ts";

const INSERT_CONNECTIONS = 16;
/** Subscriptions opened per batch, so 5000 SYNs don't land at once. */
const OPEN_BATCH = 200;

const COLUMNS = [
  "subscribers",
  "insert rps",
  "frames/s",
  "fanout p50 ms",
  "fanout p99 ms",
  "fanout max ms",
  "dropped",
  "errors",
  "rss max MB",
  "heap max MB",
  "ELU",
  "status",
];

interface Pool {
  frames: number;
  latencies: number[];
  dropped: number;
  close(): void;
}

const TS_RE = /"body":"(\d+)"/;

/**
 * Parses complete SSE frames out of a connection's buffer. The inserted record carries the
 * runner's own `Date.now()` in `body`, so arrival minus that is the fan-out latency measured on
 * one clock — no skew between runner and SUT to worry about.
 * @param buffer - Bytes received so far.
 * @param pool - Where frames and latencies are counted.
 * @returns The unparsed remainder.
 */
function consume(buffer: string, pool: Pool): string {
  let start = 0;
  for (;;) {
    const end = buffer.indexOf("\n\n", start);
    if (end === -1) break;
    const frame = buffer.slice(start, end);
    start = end + 2;
    if (frame.startsWith(":")) continue; // heartbeat
    pool.frames += 1;
    const match = TS_RE.exec(frame);
    if (match) pool.latencies.push(Date.now() - Number(match[1]));
  }
  return buffer.slice(start);
}

/**
 * Opens `count` subscriptions to `/events?collection=posts&events=create`, each a plain
 * `node:http` request kept open, and resolves once every one has its headers (the SSE handshake).
 * @param baseUrl - The SUT's origin.
 * @param count - How many subscribers.
 * @returns The pool.
 */
async function openSubscribers(baseUrl: string, count: number): Promise<Pool> {
  const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
  const sockets: http.ClientRequest[] = [];
  const pool: Pool = {
    frames: 0,
    latencies: [],
    dropped: 0,
    close() {
      for (const request of sockets) request.destroy();
      agent.destroy();
    },
  };
  let closing = false;
  const original = pool.close;
  pool.close = () => {
    closing = true;
    original();
  };

  const open = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const request = http.get(
        `${baseUrl}/events?collection=posts&events=create`,
        { agent },
        (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`subscribe: HTTP ${response.statusCode}`));
            return;
          }
          let buffer = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            buffer = consume(buffer + chunk, pool);
          });
          response.on("close", () => {
            if (!closing) pool.dropped += 1;
          });
          resolve();
        },
      );
      request.on("error", (error) => {
        if (closing) return;
        pool.dropped += 1;
        reject(error);
      });
      sockets.push(request);
    });

  for (let opened = 0; opened < count; opened += OPEN_BATCH) {
    const batch = Math.min(OPEN_BATCH, count - opened);
    await Promise.allSettled(Array.from({ length: batch }, open));
  }
  return pool;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;
}

const insertRequest: CannonRequest = {
  method: "POST",
  path: "/collections/posts",
  headers: { "content-type": "application/json" },
  setupRequest(request) {
    request.body = JSON.stringify({ title: "fan-out", body: String(Date.now()) });
    return request;
  },
};

/**
 * Fan-out is synchronous on the bus: every insert walks every subscriber before the insert's own
 * response goes out, and each subscriber holds a `ReadableStream` plus a heartbeat interval. This
 * is where that stops scaling on 1 core / 1 GB: insert throughput at each level, frames actually
 * delivered, the fan-out latency, and the first level at which connections drop.
 */
export const sseFanout: Scenario = {
  id: "sse-fanout",
  sut: "open",
  description: `N subscribers (--subscribers, default 0/100/1000/5000) on /events?collection=posts&events=create, then POST /collections/posts at c=${INSERT_CONNECTIONS}. Fan-out is synchronous per insert, so insert rps and frames/s are two views of the same loop; latency is insert send to frame arrival, on the runner's clock. Stops at the first level that drops a subscriber or errors.`,
  columns: COLUMNS,
  async run(context) {
    const statsUrl = `${context.baseUrl}/__bench/stats`;
    if (context.warmup > 0) {
      await cannon({
        url: context.baseUrl,
        connections: INSERT_CONNECTIONS,
        duration: context.warmup,
        requests: [insertRequest],
      });
    }

    for (const subscribers of context.subscribers) {
      context.log(`sse-fanout subscribers=${subscribers}`);
      const pool = await openSubscribers(context.baseUrl, subscribers);
      const openDropped = pool.dropped;
      const sampler = startSampling(statsUrl);
      const load = await cannon({
        url: context.baseUrl,
        connections: INSERT_CONNECTIONS,
        duration: context.duration,
        requests: [insertRequest],
        title: `sse-fanout N=${subscribers}`,
      });
      // Let the frames of the last inserts arrive before counting.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const stats = await sampler.stop();
      pool.close();

      const sorted = pool.latencies.toSorted((a, b) => a - b);
      const unreachable = stats.samples === 0;
      const status = unreachable
        ? "SUT unreachable"
        : pool.dropped > 0
          ? `dropped ${pool.dropped} (${openDropped} while opening)`
          : load.errors > 0
            ? "insert errors"
            : "ok";
      await context.onRow({
        subscribers,
        "insert rps": load.rps,
        "frames/s": pool.frames / load.durationS,
        "fanout p50 ms": percentile(sorted, 0.5),
        "fanout p99 ms": percentile(sorted, 0.99),
        "fanout max ms": percentile(sorted, 1),
        dropped: pool.dropped,
        errors: load.errors,
        "rss max MB": stats.rssMaxMB,
        "heap max MB": stats.heapMaxMB,
        ELU: stats.eluAvg,
        status,
      });
      if (status !== "ok") break;
      // Give the SUT a moment to tear the subscriptions down before the next level.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  },
};
