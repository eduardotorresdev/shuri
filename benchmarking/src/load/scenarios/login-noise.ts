import { cannon, rotateIds, runLoad, type CannonRequest } from "../autocannon.ts";
import type { Fixtures } from "../fixtures.ts";
import { startSampling } from "../stats.ts";
import { HTTP_COLUMNS, toRow, type Scenario } from "./index.ts";

const LOGIN_CONNECTIONS = 4;
const READ_CONNECTIONS = 32;

function readRequests({ ids }: Fixtures): CannonRequest[] {
  return [
    { method: "GET", setupRequest: rotateIds(ids, (id) => `/collections/posts/${id}`) },
  ];
}

function loginRequests({ login }: Fixtures): CannonRequest[] {
  return [
    {
      method: "POST",
      path: "/auth/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(login),
    },
  ];
}

/**
 * What PBKDF2 does to everyone else. Login runs on the libuv threadpool, but the threadpool's
 * threads and the event loop share the one core, so reads pay for every login in progress. Three
 * rows: the reads alone (the reference), the reads while logins run, the logins themselves.
 */
export const loginNoise: Scenario = {
  id: "login-noise",
  sut: "auth",
  description:
    "`GET /collections/posts/:id` at c=32 while `POST /auth/login` runs at c=4 on the same core. The first row is the reads alone; the difference to the second is what PBKDF2 costs a read's p99.",
  columns: [...HTTP_COLUMNS],
  async run(context) {
    const statsUrl = `${context.baseUrl}/__bench/stats`;
    const common = { url: context.baseUrl, duration: context.duration };

    context.log(`login-noise reads alone c=${READ_CONNECTIONS}`);
    const alone = await runLoad({
      ...common,
      statsUrl,
      warmup: context.warmup,
      connections: READ_CONNECTIONS,
      requests: readRequests(context.fixtures),
      title: "reads alone",
    });
    await context.onRow(
      toRow(`get-record c=${READ_CONNECTIONS} alone`, alone.load, alone.stats),
    );

    context.log(`login-noise reads c=${READ_CONNECTIONS} + login c=${LOGIN_CONNECTIONS}`);
    const sampler = startSampling(statsUrl);
    const [reads, logins] = await Promise.all([
      cannon({
        ...common,
        connections: READ_CONNECTIONS,
        requests: readRequests(context.fixtures),
        title: "reads under login",
      }),
      cannon({
        ...common,
        connections: LOGIN_CONNECTIONS,
        requests: loginRequests(context.fixtures),
        title: "login under reads",
      }),
    ]);
    const stats = await sampler.stop();
    await context.onRow(toRow(`get-record c=${READ_CONNECTIONS} + login`, reads, stats));
    await context.onRow(
      toRow(`login c=${LOGIN_CONNECTIONS} + get-record`, logins, stats),
    );
  },
};
