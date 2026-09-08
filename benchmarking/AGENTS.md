# @shuri/benchmarking

Load and micro benchmarks for the toolkit, answering one question: how much does a `@shuri/sdk`
app serve when confined to **1 core and 1 GB** — req/s per route, latency as concurrency climbs,
where the knee is, and what each piece costs (the `node:http` bridge, the store, auth, SSE). Lives at
the repo root as `benchmarking/`, in the workspace so it can depend on the packages via
`workspace:*`. Private, never published.

## Tree

```
package.json            scripts: bench (docker), bench:local, bench:micro, typecheck, lint
Dockerfile              the SUT image: node:24-slim, whole repo built, CMD node benchmarking/src/sut/server.ts
docker-compose.yml      sut (cpus 1, mem_limit 1g, memswap_limit 1g, port ${BENCH_PORT:-3000}) + mongo (profile "mongo")
vitest.config.ts        benchmark.include: src/micro/**/*.bench.ts
BASELINE.md             the reference report, committed by hand after a full docker run
results/                gitignored; one directory per run: results.json, report.md, sut-<profile>.log
src/
  run.ts                the CLI: parses flags, boots the SUT per profile, runs the scenarios, writes the report as it goes
  reference.ts          measures sut/reference.ts (bare node, the bridge alone, fastify) under the same budget: the ruler
  sut/
    schema.ts           posts (text/textarea/boolean/number/select/email, public reads), authors, global site; samplePost(i)
    seed.ts             seeds posts, sessions, one client + token in-process; returns the Fixtures the runner reads
    server.ts           the SUT: env -> create() -> seed -> createServer(toNodeListener(app)) plus GET /__bench/fixtures and /__bench/stats
    reference.ts        BENCH_REFERENCE=node|bridge|fastify: the same JSON record served by bare node:http, by toNodeListener alone, by fastify
  load/
    autocannon.ts       cannon() (one raw run), runLoad() (warmup + measured run + stats), rotateIds(), LoadResult
    stats.ts            samples /__bench/stats once a second during a measurement: rss/heap peaks, event loop utilization
    fixtures.ts         polls /__bench/fixtures until the SUT has finished seeding
    sut.ts              starts/stops the SUT: docker compose (build/up/rm/down, --profile mongo) or a local child process
    report.ts           RunReport -> results.json + report.md (one markdown table per scenario)
    scenarios/
      index.ts          Scenario/ScenarioContext, httpScenario() (the shape most scenarios share), HTTP_COLUMNS, toRow()
      registry.ts       every scenario in run order; selectScenarios(--scenarios)
      get-record.ts     GET /collections/posts/:id, ids rotated                                  [sweep]
      list-page.ts      GET /collections/posts?limit=20
      list-filtered.ts  GET ...?where={published eq true}&orderBy=[{title}]&limit=20
      get-global.ts     GET /globals/site
      openapi.ts        GET /openapi.json
      update.ts         PATCH /collections/posts/:id
      insert.ts         POST /collections/posts                                                  [sweep]
      mixed-crud.ts     80% get / 15% list / 5% insert
      auth-session.ts   GET /collections/posts/:id with Cookie shuri_session                     [sweep]  (auth profile)
      auth-client.ts    GET /collections/posts/:id with Bearer sct_...                                    (auth profile)
      login.ts          POST /auth/login at c = 1, 4, 16                                                  (auth profile)
      login-noise.ts    get-record c=32 alone, then with login c=4 in parallel                            (auth profile)
      sse-fanout.ts     N subscribers on /events (--subscribers, default 0/100/1000/5000) under insert c=16; runs last, own boot
  micro/
    handler.bench.ts        app.handler(new Request(...)) in-process, 10k posts: get/list/insert, session, client token, anonymous
    validate-record.bench.ts validateRecord over the six-field posts record
    match.bench.ts          matchesWhere: eq / contains / in / a list of filters
    redact.bench.ts         redactRecord with and without a hidden field
```

## Topology

```
host (macOS/Linux, N cores)                       container (cpus: 1, mem_limit: 1g)
┌────────────────────────────────┐   :3000        ┌──────────────────────────────────┐
│ src/run.ts + autocannon        │ ─────────────▶ │ node src/sut/server.ts           │
│ samples /__bench/stats 1x/s    │                │ create() + toNodeListener()       │
└────────────────────────────────┘                └──────────────────────────────────┘
                                                  [--adapter mongo] mongo:8, unconstrained
```

- **The budget is the cgroup.** `cpus: "1"`, `mem_limit: 1g`, `memswap_limit: 1g` in the compose
  file are the whole isolation story; Node runs with default flags inside, because that is what a
  consumer gets. `--mode local` skips Docker and runs the SUT as a child process with
  `--max-old-space-size=1024`: no core is pinned, the RSS is not capped, and the report says so.
- **The generator runs on the host**, outside the budget, against the published port. Caveat on
  macOS: the VM port-forward adds ~0.1–0.3 ms to every latency; on Linux the runner can hit the
  container directly. The SUT saturates one core long before that floor matters.
- **Mongo, when on, is outside the budget** in its own container: the numbers measure the lib over
  a real database, not the database. In local mode the runner still brings it up through compose.
- **Fixtures come from the SUT, not the public API.** `seed.ts` runs in-process and hands the runner
  1000 ids, one session cookie, one client token and the login credentials through
  `GET /__bench/fixtures`. Seeding 1000 sessions through `POST /auth/login` would be 1000 PBKDF2
  runs (600k iterations each) — minutes on one core; `app.auth.createSession` is a SHA-256 each.
- **Memory and event loop come from `GET /__bench/stats`** (`process.memoryUsage()` and
  `performance.eventLoopUtilization()`, as a delta since the last sample) in both modes, so
  `rss max MB` means the same thing in docker and local. Both support routes are answered by a
  wrapper around `toNodeListener`: one `startsWith("/__bench/")` per request, outside the lib.
- **One boot per run of consecutive scenarios of a profile.** Scenarios declare `sut: "open"`
  (`BENCH_AUTH=off`) or `"auth"` (`on`); the registry order is the boot order: open, then auth,
  then open again for `sse-fanout`, which goes last so that a subscriber level that takes the SUT
  (or, on macOS, the Docker VM's network) down loses nothing else. Within a profile reads run
  before writes, so read numbers describe the seeded table rather than one grown by the insert
  sweep. Before every scenario the runner checks `/__bench/stats`; an unreachable SUT aborts the
  profile instead of producing tables of errors.
- **Sweeps only where the knee is interesting**: `get-record`, `insert` and `auth-session` run at
  every `--connections` value; `login` at 1/4/16; everything else at c=64.

## Running

```
pnpm bench                                  # docker, memory adapter, every scenario (~15 min)
pnpm bench -- --adapter mongo               # same, over the mongo profile
pnpm bench:local -- --scenarios get-record,insert --duration 3
pnpm bench:micro                            # vitest bench, in-process
pnpm bench:reference                        # bare node / bridge / fastify in the same container budget
node src/run.ts --help                      # every flag
```

Flags: `--mode docker|local`, `--adapter memory|mongo`, `--scenarios a,b`, `--connections
1,8,32,64,128,256,512,1024`, `--subscribers 0,100,1000,5000`, `--duration 10`, `--warmup 3`,
`--posts 10000`, `--sessions 1000`, `--port 3000`, `--out results/`. Each run writes
`results/<timestamp>/` incrementally, so a run that dies keeps everything measured until then.

On macOS: raise the fd limit first if it is still 256 (`ulimit -n 65536`), and cap the sweep at
`--connections 1,8,32,64,128,256,512` — the Rancher/Docker Desktop port-forward starts timing out
around 512 concurrent connections, refuses everything at 1024, and in one run took the Docker
daemon down with it. `BASELINE.md` was measured with that cap; a Linux host with `--network host`
can run the full sweep.

## Reading the numbers

- `rps` is autocannon's mean over the measured window; `p50/p99/max` are its latency histogram,
  in milliseconds, at 1 ms resolution. `errors` are connection errors and timeouts; `non2xx` is the
  count of responses outside 2xx — both must be 0 for a row to mean anything.
- `ELU` is the SUT's mean event loop utilization across the one-second samples: 1.0 is a saturated
  core. A route whose rps stops climbing while ELU sits below 1 is waiting on something other than
  the loop (the threadpool, for `login`).
- `get-record` vs `handler.bench.ts`'s in-process GET is the cost of the `node:http` bridge plus
  Node's own HTTP parser and socket. `bench:reference` splits that: bare `node:http` is the ceiling
  of the box, `bridge` is `toNodeListener` around a handler that does nothing, `fastify` is a
  popular framework doing the same — all measured under the same 1-core budget, so they are the
  comparison the public framework benchmarks (multi-core, unspecified hardware) can't be.
- `auth-session` vs `get-record` is principal resolution: a SHA-256 plus a `findMany` with `eq` on
  `tokenHash`. `_sessions.tokenHash` is declared `index: true`, so both adapters answer it in
  O(1); with the index the gap should stay flat as `--sessions` grows.
- `sse-fanout`: fan-out is synchronous per insert, so insert rps and frames/s are the same loop
  seen twice; `status` names the first level that dropped a subscriber or lost the SUT.

## Role in the monorepo

Standalone consumer of `@shuri/sdk` (through `@shuri/sdk/node`), `@shuri/store-memory` and
`@shuri/store-mongo`, like `@shuri/demo` but for measurement. Nothing depends on it. `BASELINE.md`
is the reference every later change is compared against.
