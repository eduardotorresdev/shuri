# Baseline — 1 core, 1 GB

The reference numbers every later change is compared against, measured on 2026-09-06 (before) and
2026-09-08 (after) with `pnpm bench`. "Before" is the code as it was when the bench was written;
"after" is the same code plus the three optimizations the first run pointed at (the one-write
bridge, `index: true` on the auth lookups, the copy-free page in the memory adapter). Regenerate
with the commands in `AGENTS.md`; the `bench` GitHub Actions workflow runs the same thing on a
Linux runner without the macOS caveats below.

## Setup

- SUT: `node benchmarking/src/sut/server.ts` in `node:24-slim`, default Node flags, inside a
  container with `cpus: "1"`, `mem_limit: 1g`, `memswap_limit: 1g` (verified with `docker inspect`:
  NanoCpus 1e9, Memory 1 GiB, MemorySwap 1 GiB; `docker stats` showed 96% CPU under load).
- Seed: 10,000 posts (six fields each), 1,000 sessions of one user, one client token.
- Load: autocannon on the host, 10 s measured after 3 s warmup, per concurrency. Sweep:
  c = 1, 8, 32, 64, 128, 256 (after) / 512 (before). Non-sweep scenarios run at c = 64.
- Host: macOS arm64, Apple M4 (10 cores), Node v24.13.1, Rancher Desktop 1.23 (Lima VM).
- Caveats. (1) The VM port-forward adds ~0.1–0.3 ms to every latency and fails first at high
  concurrency: timeouts and `errors` from c = 512, refused connections at 1024, and twice the Docker
  socket itself went down. The sweep is capped at 256 for that reason, and `sse-fanout` above 1,000
  subscribers comes from local mode. (2) The host is a workstation: two of the five "after" runs
  were disturbed by antivirus and IDE activity and were discarded; the tables below come from the
  runs whose reference rows (c = 1, c = 8) match across runs. The CI workflow exists so that this
  is not a judgement call next time. (3) Mongo runs in its own unconstrained container.

## Before → after, memory adapter, same container

| scenario                                             |   c |       before rps |        after rps |       change | what changed                                        |
| ---------------------------------------------------- | --: | ---------------: | ---------------: | -----------: | --------------------------------------------------- |
| get-record                                           |  32 |            7,860 |           13,852 |         +76% | one-write bridge                                    |
| get-record                                           |   8 |            7,362 |           12,826 |         +74% | one-write bridge                                    |
| get-global                                           |  64 |            4,882 |            7,891 |         +62% | one-write bridge                                    |
| openapi                                              |  64 |            3,760 |            6,973 |         +85% | one-write bridge (a 100 KB body)                    |
| list-page                                            |  64 |            2,760 |            3,211 |         +16% | no table copy; the 20-record JSON dominates         |
| list-filtered                                        |  64 |              636 |              676 |          +6% | `eq` off the index; the sort of ~5k rows dominates  |
| update                                               |  64 |            3,584 |            7,034 |         +96% | one-write bridge                                    |
| insert                                               |  32 |            4,517 |            6,507 |         +44% | one-write bridge                                    |
| mixed-crud                                           |  64 |            2,650 |            4,784 |         +81% | bridge + no table copy on the list share            |
| auth-session                                         |  32 |            2,471 |            6,152 |        +149% | `index: true` on `_sessions.tokenHash` + bridge     |
| auth-session                                         |  64 |            2,552 |            6,390 |        +150% | same; now on par with the open read of the same run |
| auth-client                                          |  64 |            4,650 |            3,967 | −15% (noise) | one row either way; the after-row's max was 534 ms  |
| login                                                |   1 |               15 |               13 |            — | PBKDF2, unchanged by design                         |
| login-noise: reads alone → with 4 logins             |  32 |    5,294 → 1,649 |    7,436 → 2,285 |            — | the 3x collapse under logins is unchanged           |
| sse-fanout insert rps at 0 / 100 / 1,000 subscribers |  16 | 3,500 / 403 / 30 | 4,412 / 357 / 28 |            — | socket-write bound, unchanged                       |

In-process (`pnpm bench:micro`, quiet host): `GET /:id` 132k ops/s (7.6 µs), `POST` 79k, list of 20
41k, **session cookie 34k (29 µs) — before the index it was ~600 ops/s (1.6 ms), a scan of 1,000
rows per request**; client token 36k; anonymous under auth 94k.

## Where it stands: good, acceptable, bad

References measured on the **same box and the same 1-core container** with `pnpm bench:reference`
(`GET` returning one JSON record): bare `node:http` ≈ 19k rps, fastify 5.11 ≈ 12–13k rps, this
lib ≈ 14k rps (`get-record`, c = 32). Locally, back to back in one quiet minute: bare node 49.5k,
bridge alone 18.4k, full SUT 18.0k, fastify 13.6k. The public numbers for comparison are Fastify's
own page (fastify 88k, express 58k, koa 57k rps on an unspecified multi-core box,
<https://fastify.dev/benchmarks/>), so only ratios travel: on that page express is 66% of
fastify; here the lib is roughly at fastify's level and at 30–40% of bare Node.

| area                          | number (1 core, 1 GB)                                                                  | verdict                                          | why, and the reference                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read by id                    | 13.9k rps, p50 1 ms, p99 8 ms at c = 32                                                | **good**                                         | Same ballpark as fastify in the same container (12–13k); ~70% of bare node (19k). The lib core costs ~8 µs of the ~70 µs a request takes; the rest is Node's HTTP stack and the bridge.                                                                                                                         |
| Write (insert / update)       | 6.5k / 7.0k rps                                                                        | **good**                                         | Six-field validation + hook chain + adapter in ~25 µs of lib time. PocketBase's own guidance is "1000+ concurrent requests/s on 1 vCPU / 1 GB" (<https://github.com/pocketbase/benchmarks>), an order of magnitude below.                                                                                       |
| Latency at the knee           | p99 8–33 ms up to c = 64                                                               | **good**                                         | Knee between c = 8 and c = 32, as expected for one core. Past c = 128 latency is pure queueing (p50 ≈ c / rps).                                                                                                                                                                                                 |
| Memory                        | RSS ≤ 412 MB in any scenario, 204 MB with 5,000 SSE subscribers                        | **good**                                         | The 1 GB cap was never the constraint. Node keeps ~10 KB per idle SSE connection, in line with the usual figure for Node SSE (<https://www.hirenodejs.com/blog/nodejs-server-sent-events-sse-2026>).                                                                                                            |
| Authenticated read (cookie)   | 6.2k rps, flat in `--sessions`                                                         | **good now, was bad**                            | Before the index: 2.5k rps and O(sessions), 6x slower again at 10k sessions. Now within noise of the open read. Same fix on Mongo (`createIndex` on `tokenHash`).                                                                                                                                               |
| Client-token read             | 4.0–4.7k rps                                                                           | acceptable                                       | One row lookup plus scope expansion against the schema on every request; could be memoized per token, not worth it yet.                                                                                                                                                                                         |
| Bridge overhead               | lib ≈ bridge-only ≈ 18k vs bare node 49.5k (local)                                     | acceptable                                       | The web-standard `Request`/`Response` objects cost ~60% of a bare-node request even with the one-write path; that is the price of running unmodified on Deno/Bun/Workers. Fastify avoids it by never creating them.                                                                                             |
| List with filter + sort       | 676 rps (memory), 154 rps (Mongo, before)                                              | **bad**                                          | The `eq` is indexed but the sort of ~5,000 matching rows on every request is not: `localeCompare` in memory, an in-memory sort on Mongo's side. Needs either a compound index (Mongo) or a cursor/keyset page; a 20-row page should never touch 5,000 rows.                                                     |
| Plain list page               | 3.2k rps (memory), 2.2k (Mongo)                                                        | acceptable                                       | Copy-free now; what remains is 20 records of JSON and 20 `afterRead` hook runs.                                                                                                                                                                                                                                 |
| Login                         | 13–15 logins/s per core, p50 55–70 ms                                                  | acceptable by design                             | OWASP's floor for PBKDF2-HMAC-SHA256 is 600,000 iterations and "a hash should take less than one second" (<https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>). Argon2id at m=19 MiB, t=2 would cost less CPU time but native deps.                                              |
| Everything else during logins | reads 7.4k → 2.3k rps with 4 concurrent logins                                         | **bad**                                          | PBKDF2 runs on libuv's 4-thread pool (<https://nodejs.org/api/cli.html#uv_threadpool_sizesize>), which shares the one core with the event loop. Four logins in flight take ~70% of the box. Mitigation is policy: rate-limit `/auth/login`, or move hashing to a worker/process.                                |
| SSE fan-out                   | 100 subscribers: 357–403 inserts/s, 36–40k frames/s; 1,000: ~30/s; 5,000: 11/s (local) | **bad for public fan-out, fine for an admin UI** | The bus costs 2 µs per subscriber per event; each frame is a `writev`, and 1 core does ~40–60k socket writes/s. Every subscriber divides the insert rate. Production SSE at scale fans out through Redis across processes, not one loop (<https://www.hirenodejs.com/blog/nodejs-server-sent-events-sse-2026>). |
| Mongo adapter                 | get 2.4–2.9k, insert ~560, update ~300 rps (before)                                    | acceptable, unverified after                     | CPU-bound in the driver (BSON + one round trip per op; `update` is two). The post-optimization Mongo run was discarded for host noise; the CI workflow re-measures it.                                                                                                                                          |

## Reference servers, same container (`pnpm bench:reference`, 8 s after 3 s warmup)

| server                            |   c |    rps | p50 ms | p99 ms |
| --------------------------------- | --: | -----: | -----: | -----: |
| bare node:http                    |  64 | 19,426 |      3 |      7 |
| fastify 5.11                      |  32 | 13,061 |      2 |      7 |
| fastify 5.11                      |  64 | 11,739 |      4 |     14 |
| this lib, get-record (memory run) |  32 | 13,852 |      1 |      8 |

The `bridge` rows of that run (6.0k) and bare node at c = 32 (6.7k) were hit by an antivirus burst
and are not listed; the local back-to-back pass (node 49.5k, bridge 18.4k, SUT 18.0k, fastify
13.6k at c = 32) is the consistent measurement of the bridge's share.

## Micro benchmarks (`pnpm bench:micro`, in-process, quiet host, after)

| bench                                                                |               ops/s |     mean |
| -------------------------------------------------------------------- | ------------------: | -------: |
| `app.handler` GET /collections/posts/:id (auth off)                  |             131,995 |   7.6 µs |
| `app.handler` GET /collections/posts?limit=20 (auth off)             |              41,382 |    24 µs |
| `app.handler` POST /collections/posts (auth off)                     |              79,053 |    13 µs |
| `app.handler` GET /:id with session cookie (auth on, 1,000 sessions) |              34,464 |    29 µs |
| `app.handler` GET /:id with client token (auth on)                   |              35,582 |    28 µs |
| `app.handler` GET /:id anonymous (auth on)                           |              93,838 |    11 µs |
| `validateRecord`, posts, valid record                                |           1,002,021 |   1.0 µs |
| `validateRecord`, posts, partial (one field)                         |           1,319,695 |   0.8 µs |
| `validateRecord`, posts, three issues                                |           1,126,501 |   0.9 µs |
| `matchesWhere` eq / contains / in                                    | 11.2M / 8.5M / 9.5M | ≤ 0.1 µs |
| `matchesWhere` list of filters + two fields                          |           6,293,904 |   0.2 µs |
| `redactRecord`, no hidden field                                      |          24,253,506 |  0.04 µs |
| `redactRecord`, one hidden field (copies 7 keys)                     |           1,850,964 |   0.5 µs |

## Load, after — memory adapter

Open profile from `results/2026-09-08T18-11-05-710Z`; auth profile from
`results/2026-09-08T13-54-20-336Z` (the later run's auth rows were disturbed by host activity and
discarded); `sse-fanout` from both, plus the local-mode run to 5,000.

## get-record (open)

`GET /collections/posts/:id`, ids rotated over the first 1000 seeded posts. The floor of the HTTP bridge + one `findOne` + one JSON record.

|   c |    rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | -----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 |  4,490 |    0.0 |    0.0 |    5.0 |      0 |      0 |      177.8 |        49.4 | 0.33 |
|   8 | 12,826 |    0.0 |    2.0 |   47.0 |      0 |      0 |      176.5 |        47.0 | 0.89 |
|  32 | 13,852 |    1.0 |    8.0 |   74.0 |      0 |      0 |      183.4 |        54.2 | 0.98 |
|  64 | 10,056 |    5.0 |   24.0 |  222.0 |      0 |      0 |      186.2 |        49.3 | 1.00 |
| 128 | 10,218 |   10.0 |   34.0 |  610.0 |      0 |      0 |      186.5 |        54.6 | 1.00 |
| 256 |  9,218 |   21.0 |   76.0 | 3914.0 |      0 |      0 |      187.8 |        67.8 | 1.00 |

## list-page (open)

`GET /collections/posts?limit=20`: no filter, no sort, so the memory adapter pages straight off its table iterator and the cost is the 20 records, not the seed.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 3,211 |   13.0 |  111.0 |  771.0 |      0 |      0 |      188.8 |        50.8 | 1.00 |

## list-filtered (open)

`GET /collections/posts?where={published eq true}&orderBy=[{title}]&limit=20`: the `eq` on `published` (indexed) yields ~50% of the table, which is then sorted by `title` and paged to 20. The sort is the cost.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 676 |   68.0 |  711.0 | 2751.0 |      0 |      0 |      200.0 |        43.9 | 0.95 |

## get-global (open)

`GET /globals/site`: the globals handler over a one-row lookup.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 7,891 |    6.0 |   30.0 |  109.0 |      0 |      0 |      200.0 |        51.3 | 0.97 |

## openapi (open)

`GET /openapi.json`: the document is built once at first request and cached, so this is `JSON.stringify` + the bytes on the wire.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 6,973 |    7.0 |   25.0 |  248.0 |      0 |      0 |      201.8 |        46.0 | 0.97 |

## update (open)

`PATCH /collections/posts/:id` with `{ views }`, ids rotated over the fixtures. A pre-image `findOne`, partial `validateRecord`, hook chain, adapter update.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 7,034 |    8.0 |   25.0 |  203.0 |      0 |      0 |      205.7 |        57.3 | 1.00 |

## insert (open)

`POST /collections/posts` with all six fields set. Body parsing + `validateRecord` + hook chain + adapter insert. The table grows by the number of requests, which the read scenarios that follow do not see: they run first.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 | 3,032 |    0.0 |    0.0 |  178.0 |      0 |      0 |      208.5 |        62.0 | 0.26 |
|   8 | 5,256 |    1.0 |    7.0 |  213.0 |      0 |      0 |      240.6 |        97.1 | 0.95 |
|  32 | 6,507 |    4.0 |   16.0 |   87.0 |      0 |      0 |      296.6 |       149.9 | 1.00 |
|  64 | 6,132 |    9.0 |   33.0 |  224.0 |      0 |      0 |      367.1 |       211.9 | 1.00 |
| 128 | 4,554 |   21.0 |  118.0 | 1657.0 |      0 |      0 |      372.5 |       231.2 | 0.92 |
| 256 | 4,506 |   43.0 |  212.0 | 4244.0 |      0 |      0 |      410.5 |       259.4 | 0.97 |

## mixed-crud (open)

80% `GET /collections/posts/:id`, 15% `GET /collections/posts?limit=20`, 5% `POST /collections/posts`, cycled per connection.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 4,784 |   10.0 |   49.0 |  453.0 |      0 |      0 |      411.9 |       275.9 | 0.99 |

## auth-session (auth)

`GET /collections/posts/:id` with `Cookie: shuri_session=...` among `--sessions` seeded rows. Compare with `get-record`: the difference is principal resolution — a SHA-256 and a `findMany` with `eq` on `tokenHash`, which the memory adapter answers by scanning every session.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 | 2,255 |    0.0 |    1.0 |   13.0 |      0 |      0 |      169.6 |        53.3 | 0.23 |
|   8 | 6,171 |    1.0 |    5.0 |  111.0 |      0 |      0 |      173.2 |        47.4 | 0.90 |
|  32 | 6,152 |    4.0 |   19.0 |  115.0 |      0 |      0 |      176.1 |        48.0 | 1.00 |
|  64 | 6,390 |    8.0 |   35.0 |  291.0 |      0 |      0 |      176.3 |        48.9 | 1.00 |
| 128 | 4,711 |   22.0 |   92.0 |  425.0 |      0 |      0 |      176.8 |        44.7 | 1.00 |
| 256 | 2,415 |   55.0 |  516.0 | 6125.0 |      0 |      0 |      176.8 |        47.5 | 1.00 |
| 512 | 2,526 |   52.0 | 1059.0 | 9996.0 |    310 |      0 |      178.9 |        49.7 | 1.00 |

## auth-client (auth)

`GET /collections/posts/:id` with `Authorization: Bearer sct_...`. The `sct_` prefix routes to `_client_tokens` (one seeded row), then the client's roles are expanded against the schema's scopes on every request.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 3,967 |   10.0 |   88.0 |  534.0 |      0 |      0 |      179.2 |        52.6 | 1.00 |

## login (auth)

`POST /auth/login` with the seeded credentials. PBKDF2-SHA256, 600k iterations, per request: c=1 is the ceiling of logins/s on the core; c=4 and c=16 show the threadpool (4 threads by default) queueing behind it.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 |  13 |   69.0 |  135.0 |  139.0 |      0 |      0 |      179.0 |        43.7 | 0.05 |
|   4 |  14 |  266.0 |  576.0 |  580.0 |      0 |      0 |      179.0 |        44.8 | 0.05 |
|  16 |  12 | 1295.0 | 3281.0 | 3282.0 |      0 |      0 |      180.6 |        46.1 | 0.16 |

## login-noise (auth)

`GET /collections/posts/:id` at c=32 while `POST /auth/login` runs at c=4 on the same core. The first row is the reads alone; the difference to the second is what PBKDF2 costs a read's p99.

|                       c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| ----------------------: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   get-record c=32 alone | 7,436 |    3.0 |   16.0 |   89.0 |      0 |      0 |      209.3 |        67.8 | 0.99 |
| get-record c=32 + login | 2,285 |    7.0 |   75.0 |  203.0 |      0 |      0 |      209.3 |        56.5 | 0.91 |
|  login c=4 + get-record |     9 |  404.0 |  747.0 |  747.0 |      0 |      0 |      209.3 |        56.5 | 0.91 |

## sse-fanout (open)

N subscribers (--subscribers, default 0/100/1000/5000) on /events?collection=posts&events=create, then POST /collections/posts at c=16. Fan-out is synchronous per insert, so insert rps and frames/s are two views of the same loop; latency is insert send to frame arrival, on the runner's clock. Stops at the first level that drops a subscriber or errors.

| subscribers | insert rps | frames/s | fanout p50 ms | fanout p99 ms | fanout max ms | dropped | errors | rss max MB | heap max MB |  ELU |        status |
| ----------: | ---------: | -------: | ------------: | ------------: | ------------: | ------: | -----: | ---------: | ----------: | ---: | ------------: |
|           0 |      4,413 |        0 |             - |             - |             - |       0 |      0 |      209.7 |        66.6 | 0.88 |            ok |
|         100 |        357 |   35,794 |          38.0 |         143.0 |         261.0 |       0 |      0 |      213.3 |        68.2 | 0.91 |            ok |
|       1,000 |         28 |   29,770 |         495.0 |        1500.0 |        2789.0 |       0 |  5,187 |      215.8 |        65.1 | 0.93 | insert errors |

### sse-fanout to 5,000 subscribers — local mode (approximation)

`pnpm bench:local -- --scenarios sse-fanout --subscribers 0,100,1000,5000`: no core pinned, runner
and SUT sharing the host, no port-forward. The 100 and 1,000 rows agree with the container, which
is what makes the 5,000 row credible. No connection dropped; RSS peaked at 204 MB. The insert rate
at 0 subscribers (15.9k) is the host's own speed, not the container's.

| subscribers | insert rps | frames/s | fanout p50 ms | fanout p99 ms | fanout max ms | dropped | errors | rss max MB | heap max MB |  ELU | status |
| ----------: | ---------: | -------: | ------------: | ------------: | ------------: | ------: | -----: | ---------: | ----------: | ---: | -----: |
|           0 |     15,876 |        0 |             - |             - |             - |       0 |      0 |      319.7 |       163.8 | 0.92 |     ok |
|         100 |        403 |   39,696 |          20.0 |         425.0 |        1183.0 |       0 |      0 |      259.4 |       169.5 | 0.95 |     ok |
|       1,000 |         62 |   63,536 |         202.0 |         802.0 |         848.0 |       0 |      0 |      242.0 |       174.8 | 0.91 |     ok |
|       5,000 |         11 |   63,107 |        1300.0 |        3363.0 |        3524.0 |       0 |      0 |      204.4 |       154.5 | 0.33 |     ok |

## Load, before — memory adapter (`results/2026-09-06T22-52-13-045Z`)

## get-record (open)

`GET /collections/posts/:id`, ids rotated over the first 1000 seeded posts. The floor of the HTTP bridge + one `findOne` + one JSON record.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 | 3,269 |    0.0 |    1.0 |   31.0 |      0 |      0 |      175.2 |        42.9 | 0.39 |
|   8 | 7,362 |    0.0 |    4.0 |   24.0 |      0 |      0 |      202.5 |        53.4 | 0.97 |
|  32 | 7,860 |    3.0 |   16.0 |   90.0 |      0 |      0 |      202.5 |        55.7 | 1.00 |
|  64 | 7,083 |    7.0 |   29.0 |  231.0 |      0 |      0 |      203.9 |        47.0 | 1.00 |
| 128 | 6,038 |   18.0 |   58.0 | 1387.0 |      0 |      0 |      204.1 |        59.7 | 1.00 |
| 256 | 6,196 |   33.0 |  112.0 | 4795.0 |      0 |      0 |      207.0 |        53.3 | 1.00 |
| 512 | 5,026 |   44.0 |  143.0 | 9971.0 |    176 |      0 |      207.6 |        52.9 | 1.00 |

## list-page (open)

`GET /collections/posts?limit=20`: the memory adapter materializes the whole table on every `findMany` before slicing, so this scales with the seed, not the page.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 2,760 |   17.0 |   82.0 |  788.0 |      0 |      0 |      208.7 |        51.7 | 0.95 |

## list-filtered (open)

`GET /collections/posts?where={published eq true}&orderBy=[{title}]&limit=20`: full-table filter, then a sort of the ~50% that matched, then a page of 20.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 636 |   91.0 |  229.0 | 3107.0 |      0 |      0 |      212.0 |        64.7 | 1.00 |

## get-global (open)

`GET /globals/site`: the globals handler over a one-row lookup.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 4,882 |   11.0 |   40.0 |  215.0 |      0 |      0 |      212.2 |        55.4 | 0.95 |

## openapi (open)

`GET /openapi.json`: the document is built once at first request and cached, so this is `JSON.stringify` + the bytes on the wire.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 3,760 |   14.0 |   50.0 |  103.0 |      0 |      0 |      215.6 |        53.3 | 1.00 |

## update (open)

`PATCH /collections/posts/:id` with `{ views }`, ids rotated over the fixtures. A pre-image `findOne`, partial `validateRecord`, hook chain, adapter update.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 3,584 |   14.0 |   71.0 |  410.0 |      0 |      0 |      216.2 |        52.1 | 1.00 |

## insert (open)

`POST /collections/posts` with all six fields set. Body parsing + `validateRecord` + hook chain + adapter insert. The table grows by the number of requests, which the read scenarios that follow do not see: they run first.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 | 2,161 |    0.0 |    1.0 |   12.0 |      0 |      0 |      218.2 |        51.1 | 0.42 |
|   8 | 3,308 |    1.0 |   13.0 |  155.0 |      0 |      0 |      221.7 |        74.1 | 0.94 |
|  32 | 4,517 |    5.0 |   29.0 |   89.0 |      0 |      0 |      264.9 |       131.3 | 1.00 |
|  64 | 2,121 |   17.0 |  198.0 |  609.0 |      0 |      0 |      273.8 |       145.7 | 0.98 |
| 128 | 2,740 |   33.0 |  206.0 | 2130.0 |      0 |      0 |      284.3 |       146.4 | 1.00 |
| 256 | 2,254 |   41.0 |  459.0 | 9812.0 |     16 |      0 |      305.1 |       148.6 | 1.00 |
| 512 | 3,878 |   41.0 |  227.0 | 9969.0 |    150 |      0 |      329.3 |       176.7 | 1.00 |

## mixed-crud (open)

80% `GET /collections/posts/:id`, 15% `GET /collections/posts?limit=20`, 5% `POST /collections/posts`, cycled per connection.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 2,650 |   20.0 |   77.0 |  584.0 |      0 |      0 |      391.8 |       234.2 | 1.00 |

## auth-session (auth)

`GET /collections/posts/:id` with `Cookie: shuri_session=...` among `--sessions` seeded rows. Compare with `get-record`: the difference is principal resolution — a SHA-256 and a `findMany` with `eq` on `tokenHash`, which the memory adapter answers by scanning every session.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 | 1,709 |    0.0 |    1.0 |   30.0 |      0 |      0 |      171.6 |        44.5 | 0.43 |
|   8 | 2,410 |    2.0 |   19.0 |   44.0 |      0 |      0 |      176.4 |        43.8 | 0.95 |
|  32 | 2,471 |   10.0 |   44.0 |  181.0 |      0 |      0 |      185.4 |        44.5 | 0.99 |
|  64 | 2,552 |   21.0 |   63.0 |  376.0 |      0 |      0 |      203.2 |        49.9 | 1.00 |
| 128 | 2,642 |   42.0 |  101.0 |  923.0 |      0 |      0 |      218.9 |        62.4 | 1.00 |
| 256 | 2,477 |   83.0 |  158.0 | 6555.0 |      0 |      0 |      218.9 |        61.4 | 1.00 |
| 512 | 1,799 |  100.0 |  966.0 | 9969.0 |    285 |      0 |      218.9 |        62.3 | 1.00 |

## auth-client (auth)

`GET /collections/posts/:id` with `Authorization: Bearer sct_...`. The `sct_` prefix routes to `_client_tokens` (one seeded row), then the client's roles are expanded against the schema's scopes on every request.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 4,650 |   11.0 |   38.0 |   78.0 |      0 |      0 |      218.8 |        55.1 | 1.00 |

## login (auth)

`POST /auth/login` with the seeded credentials. PBKDF2-SHA256, 600k iterations, per request: c=1 is the ceiling of logins/s on the core; c=4 and c=16 show the threadpool (4 threads by default) queueing behind it.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 |  15 |   55.0 |  163.0 |  217.0 |      0 |      0 |      219.0 |        47.7 | 0.07 |
|   4 |  18 |  202.0 |  362.0 |  364.0 |      0 |      0 |      219.0 |        37.2 | 0.16 |
|  16 |  17 |  802.0 | 2378.0 | 2378.0 |      0 |      0 |      219.0 |        41.8 | 0.18 |

## login-noise (auth)

`GET /collections/posts/:id` at c=32 while `POST /auth/login` runs at c=4 on the same core. The first row is the reads alone; the difference to the second is what PBKDF2 costs a read's p99.

|                       c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| ----------------------: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   get-record c=32 alone | 5,294 |    5.0 |   19.0 |   42.0 |      0 |      0 |      219.9 |        58.7 | 0.98 |
| get-record c=32 + login | 1,649 |   10.0 |   99.0 |  202.0 |      0 |      0 |      219.9 |        47.9 | 1.00 |
|  login c=4 + get-record |    10 |  345.0 |  797.0 |  797.0 |      0 |      0 |      219.9 |        47.9 | 1.00 |

## sse-fanout (open)

N subscribers (--subscribers, default 0/100/1000/5000) on /events?collection=posts&events=create, then POST /collections/posts at c=16. Fan-out is synchronous per insert, so insert rps and frames/s are two views of the same loop; latency is insert send to frame arrival, on the runner's clock. Stops at the first level that drops a subscriber or errors.

| subscribers | insert rps | frames/s | fanout p50 ms | fanout p99 ms | fanout max ms | dropped | errors | rss max MB | heap max MB |  ELU |        status |
| ----------: | ---------: | -------: | ------------: | ------------: | ------------: | ------: | -----: | ---------: | ----------: | ---: | ------------: |
|           0 |      3,500 |        0 |             - |             - |             - |       0 |      0 |      205.7 |        79.7 | 0.91 |            ok |
|         100 |        403 |   40,445 |          28.0 |         157.0 |         315.0 |       0 |      0 |      208.6 |        58.9 | 0.92 |            ok |
|       1,000 |         30 |   31,169 |         425.0 |        1007.0 |        1064.0 |       0 |  4,000 |      213.8 |        73.2 | 0.91 | insert errors |

## Load, before — Mongo adapter (`results/2026-09-06T23-03-01-629Z`)

Same container, same seed, `--adapter mongo`: `mongo:8` in its own unconstrained container, the
open scenarios only. The SUT still saturates its core on the driver (BSON encode/decode plus a
round trip per operation) rather than on the table copy. `list-filtered` collapses to 154 rps: a
collection scan plus an in-memory sort of ~5k documents per request, no index on `published` or
`title` at the time. The post-optimization run (indexes on both) was discarded for host noise and
is re-measured by the CI workflow.

## get-record (open)

`GET /collections/posts/:id`, ids rotated over the first 1000 seeded posts. The floor of the HTTP bridge + one `findOne` + one JSON record.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 |   371 |    1.0 |   15.0 |  371.0 |      0 |      0 |      163.8 |        36.4 | 0.47 |
|   8 | 1,650 |    3.0 |   21.0 |   55.0 |      0 |      0 |      174.6 |        38.2 | 0.98 |
|  32 | 2,438 |   11.0 |   41.0 |  129.0 |      0 |      0 |      181.6 |        42.4 | 1.00 |
|  64 | 2,400 |   23.0 |   71.0 |  433.0 |      0 |      0 |      182.8 |        44.0 | 1.00 |
| 128 | 2,881 |   38.0 |  122.0 | 1549.0 |      0 |      0 |      211.1 |        53.0 | 1.00 |
| 256 | 2,785 |   74.0 |  149.0 | 5399.0 |      0 |      0 |      211.3 |        64.7 | 1.00 |
| 512 | 2,729 |   80.0 | 4855.0 | 9971.0 |    361 |      0 |      211.4 |        50.0 | 1.00 |

## list-page (open)

`GET /collections/posts?limit=20`: the memory adapter materializes the whole table on every `findMany` before slicing, so this scales with the seed, not the page.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 2,237 |   25.0 |   81.0 |  458.0 |      0 |      0 |      214.6 |        46.3 | 1.00 |

## list-filtered (open)

`GET /collections/posts?where={published eq true}&orderBy=[{title}]&limit=20`: full-table filter, then a sort of the ~50% that matched, then a page of 20.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 154 |  321.0 | 1524.0 | 2044.0 |      0 |      0 |      214.8 |        36.5 | 0.68 |

## get-global (open)

`GET /globals/site`: the globals handler over a one-row lookup.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 610 |   83.0 |  491.0 |  756.0 |      0 |      0 |      214.8 |        44.6 | 0.99 |

## openapi (open)

`GET /openapi.json`: the document is built once at first request and cached, so this is `JSON.stringify` + the bytes on the wire.

|   c |   rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | ----: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 1,496 |   35.0 |  132.0 |  797.0 |      0 |      0 |      214.9 |        43.1 | 1.00 |

## update (open)

`PATCH /collections/posts/:id` with `{ views }`, ids rotated over the fixtures. A pre-image `findOne`, partial `validateRecord`, hook chain, adapter update.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 300 |  173.0 |  863.0 | 2953.0 |      0 |      0 |      214.4 |        44.6 | 1.00 |

## insert (open)

`POST /collections/posts` with all six fields set. Body parsing + `validateRecord` + hook chain + adapter insert. The table grows by the number of requests, which the read scenarios that follow do not see: they run first.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|   1 | 160 |    5.0 |   19.0 |   85.0 |      0 |      0 |      214.7 |        35.9 | 0.49 |
|   8 | 488 |   12.0 |   72.0 |  158.0 |      0 |      0 |      214.8 |        38.7 | 0.87 |
|  32 | 553 |   48.0 |  208.0 |  449.0 |      0 |      0 |      214.8 |        41.5 | 1.00 |
|  64 | 563 |   96.0 |  320.0 | 1664.0 |      0 |      0 |      214.8 |        42.0 | 1.00 |
| 128 | 471 |  181.0 | 4244.0 | 8876.0 |      0 |      0 |      214.8 |        35.0 | 1.00 |
| 256 | 442 |  157.0 | 5312.0 | 9830.0 |    121 |      0 |      214.8 |        42.0 | 1.00 |
| 512 | 470 |  152.0 | 5805.0 | 9881.0 |    445 |      0 |      214.8 |        38.1 | 0.76 |

## mixed-crud (open)

80% `GET /collections/posts/:id`, 15% `GET /collections/posts?limit=20`, 5% `POST /collections/posts`, cycled per connection.

|   c | rps | p50 ms | p99 ms | max ms | errors | non2xx | rss max MB | heap max MB |  ELU |
| --: | --: | -----: | -----: | -----: | -----: | -----: | ---------: | ----------: | ---: |
|  64 | 925 |   57.0 |  206.0 |  265.0 |      0 |      0 |      214.9 |        39.4 | 1.00 |
