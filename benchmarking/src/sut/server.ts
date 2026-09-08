import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { create } from "@shuri/sdk";
import { toNodeListener } from "@shuri/sdk/node";
import type { StoreAdapter } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createMongoAdapter } from "@shuri/store-mongo";
import { MongoClient } from "mongodb";
import { seed, type Fixtures } from "./seed.ts";
import { collections, globals } from "./schema.ts";

/**
 * The system under test: a `@shuri/sdk` app served through `@shuri/sdk/node`, exactly as a
 * consumer would run it, plus two support routes outside the lib's handler chain:
 *
 *   GET /__bench/fixtures   ids, session cookie, client token, login credentials
 *   GET /__bench/stats      process.memoryUsage() + event loop utilization
 *
 * Configured by environment only, so the same file boots in Docker and as a local child process:
 *
 *   BENCH_ADAPTER   memory | mongo            (default memory)
 *   BENCH_AUTH      on | off                  (default off)
 *   BENCH_POSTS     posts to seed             (default 10000)
 *   BENCH_SESSIONS  sessions to seed, auth on (default 1000)
 *   BENCH_MONGO_URL adapter=mongo only        (default mongodb://localhost:27017)
 *   PORT                                      (default 3000)
 */
const env = process.env;
const adapterKind = env["BENCH_ADAPTER"] ?? "memory";
const authOn = env["BENCH_AUTH"] === "on";
const posts = Number(env["BENCH_POSTS"] ?? 10_000);
const sessions = Number(env["BENCH_SESSIONS"] ?? 1_000);
const port = Number(env["PORT"] ?? 3000);

async function buildAdapter(): Promise<StoreAdapter> {
  if (adapterKind === "memory") return createMemoryAdapter();
  if (adapterKind !== "mongo") throw new Error(`Unknown BENCH_ADAPTER "${adapterKind}"`);
  const client = new MongoClient(env["BENCH_MONGO_URL"] ?? "mongodb://localhost:27017");
  await client.connect();
  const db = client.db("shuri_bench");
  // Every boot starts from an empty database, so a run never measures the previous run's rows.
  await db.dropDatabase();
  return createMongoAdapter({ db });
}

const startedAt = performance.now();
const app = create({
  collections,
  globals,
  adapter: await buildAdapter(),
  ...(authOn
    ? {
        auth: {
          cookie: { secure: false },
          clients: { roles: { integrator: ["posts:*"] } },
        },
      }
    : {}),
});

const fixtures: Fixtures = await seed(app, { posts, sessions });
const fixturesBody = JSON.stringify(fixtures);
const seededIn = Math.round(performance.now() - startedAt);

const listener = toNodeListener(app);
const elu = performance.eventLoopUtilization;
let lastElu = elu();

/**
 * The runner's view of the process. `eventLoopUtilization` is reported as the delta since the last
 * sample, so polling once a second yields the utilization of that second.
 * @returns The stats body.
 */
function stats(): string {
  const current = elu();
  const delta = elu(current, lastElu);
  lastElu = current;
  return JSON.stringify({
    memory: process.memoryUsage(),
    eventLoopUtilization: delta.utilization,
    uptimeMs: Math.round(performance.now()),
  });
}

function sendJson(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * One `startsWith` per request is the whole overhead of the support routes, and it sits outside
 * the lib: `toNodeListener` never sees a `/__bench/` request.
 * @param req - The incoming request.
 * @param res - The response.
 * @returns Nothing.
 */
function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";
  if (url.startsWith("/__bench/")) {
    if (url === "/__bench/fixtures") sendJson(res, fixturesBody);
    else if (url === "/__bench/stats") sendJson(res, stats());
    else res.writeHead(404).end();
    return;
  }
  listener(req, res);
}

createServer(handle).listen(port, () => {
  console.log(
    `[sut] adapter=${adapterKind} auth=${authOn ? "on" : "off"} posts=${posts} ` +
      `sessions=${fixtures.seed.sessions} seeded in ${seededIn}ms, listening on :${port}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => process.exit(0));
}
