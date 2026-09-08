import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { writeReport, type Row, type RunReport } from "./load/report.ts";
import { emptyReport, type Scenario, type SutProfile } from "./load/scenarios/index.ts";
import { selectScenarios } from "./load/scenarios/registry.ts";
import { fetchStats } from "./load/stats.ts";
import {
  buildDockerImage,
  ensureLocalMongo,
  LOCAL_MAX_OLD_SPACE_MB,
  PACKAGE_DIR,
  startSut,
  teardownDocker,
  type Adapter,
  type Mode,
} from "./load/sut.ts";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "docker" },
    adapter: { type: "string", default: "memory" },
    scenarios: { type: "string" },
    connections: { type: "string", default: "1,8,32,64,128,256,512,1024" },
    subscribers: { type: "string", default: "0,100,1000,5000" },
    duration: { type: "string", default: "10" },
    warmup: { type: "string", default: "3" },
    posts: { type: "string", default: "10000" },
    sessions: { type: "string", default: "1000" },
    port: { type: "string", default: "3000" },
    out: { type: "string", default: path.join(PACKAGE_DIR, "results") },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: node src/run.ts [options]
  --mode docker|local         docker: SUT in a 1-cpu/1GB container (default); local: child process
  --adapter memory|mongo      store adapter behind the SUT (default memory)
  --scenarios a,b             subset of scenarios, in registry order (default all)
  --connections 1,8,...       the sweep for get-record/insert/auth-session (default 1..1024)
  --subscribers 0,100,...     the SSE subscriber levels for sse-fanout (default 0,100,1000,5000)
  --duration 10 --warmup 3    seconds measured / discarded per concurrency
  --posts 10000 --sessions 1000
  --port 3000                 the port the SUT is published on
  --out results/              one directory per run is created inside`);
  process.exit(0);
}

const mode = values.mode as Mode;
const adapter = values.adapter as Adapter;
if (mode !== "docker" && mode !== "local") throw new Error(`--mode must be docker|local`);
if (adapter !== "memory" && adapter !== "mongo")
  throw new Error(`--adapter must be memory|mongo`);
const connections = values.connections.split(",").map(Number);
const subscribers = values.subscribers.split(",").map(Number);
const options: RunReport["options"] = {
  connections,
  subscribers,
  duration: Number(values.duration),
  warmup: Number(values.warmup),
  posts: Number(values.posts),
  sessions: Number(values.sessions),
  port: Number(values.port),
};
const selected = selectScenarios(values.scenarios?.split(","));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(values.out, stamp);
const report: RunReport = {
  startedAt: new Date().toISOString(),
  mode,
  adapter,
  options,
  host: {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpu: os.cpus()[0]?.model ?? "unknown",
    node: process.version,
  },
  budget:
    mode === "docker"
      ? "docker container, cpus: 1, mem_limit: 1g, memswap_limit: 1g; default Node flags"
      : `local child process with --max-old-space-size=${LOCAL_MAX_OLD_SPACE_MB}; no CPU pin, RSS not capped (approximation)`,
  caveats: [],
  scenarios: [],
};
if (mode === "docker" && process.platform === "darwin") {
  report.caveats.push(
    "macOS: the VM port-forward adds ~0.1-0.3 ms to every latency and gives out somewhere between 512 and 1024 concurrent connections (timeouts, then refused connections, then the Docker daemon itself); on Linux run the SUT with --network host to remove it.",
  );
}
if (mode === "local") {
  report.caveats.push(
    "local mode shares the host's cores with the load generator; numbers are an approximation of the 1-core budget.",
  );
}
if (adapter === "mongo") {
  report.caveats.push(
    "Mongo runs in its own unconstrained container: the numbers measure the lib over a real database, not the database.",
  );
}
if (process.platform === "darwin" && Math.max(...connections) > 200) {
  console.warn(
    `[bench] connections up to ${Math.max(...connections)} on macOS: raise the fd limit first (ulimit -n 65536) or expect connection errors.`,
  );
}

// Consecutive scenarios of one profile share a boot; the registry order decides how many boots
// there are (open, auth, then open again for sse-fanout, which goes last so that a fan-out level
// that takes the SUT down loses nothing else).
const groups: { profile: SutProfile; scenarios: Scenario[] }[] = [];
for (const scenario of selected) {
  const last = groups.at(-1);
  if (last && last.profile === scenario.sut) last.scenarios.push(scenario);
  else groups.push({ profile: scenario.sut, scenarios: [scenario] });
}

const log = (message: string): void => console.log(`[bench] ${message}`);

/**
 * Runs one scenario, appending its rows to the report as they land.
 * @param scenario - The scenario.
 * @param baseUrl - The SUT's origin.
 * @param fixtures - The SUT's fixtures.
 * @returns Nothing.
 */
async function runScenario(
  scenario: Scenario,
  baseUrl: string,
  fixtures: Awaited<ReturnType<typeof startSut>>["fixtures"],
): Promise<void> {
  const entry = emptyReport(scenario);
  report.scenarios.push(entry);
  const onRow = async (row: Row): Promise<void> => {
    entry.rows.push(row);
    log(
      `  ${Object.entries(row)
        .map(
          ([key, value]) =>
            `${key}=${typeof value === "number" ? +value.toFixed(2) : value}`,
        )
        .join(" ")}`,
    );
    await writeReport(outDir, report);
  };
  try {
    await scenario.run({
      baseUrl,
      fixtures,
      connections,
      subscribers,
      duration: options.duration,
      warmup: options.warmup,
      log,
      onRow,
    });
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    log(`${scenario.id} failed: ${entry.error}`);
  }
  await writeReport(outDir, report);
}

log(
  `mode=${mode} adapter=${adapter} scenarios=${selected.map((s) => s.id).join(",")} out=${outDir}`,
);
await mkdir(outDir, { recursive: true });
if (mode === "docker") await buildDockerImage();
else if (adapter === "mongo") await ensureLocalMongo();

/**
 * Whether the SUT still answers. Checked before every scenario: once it is gone (OOM-killed, or
 * the Docker VM's network with it) every further measurement would be a table of errors.
 * @param baseUrl - The SUT's origin.
 * @returns Whether `/__bench/stats` answered.
 */
async function reachable(baseUrl: string): Promise<boolean> {
  try {
    await fetchStats(`${baseUrl}/__bench/stats`);
    return true;
  } catch {
    return false;
  }
}

try {
  for (const [index, group] of groups.entries()) {
    const { profile } = group;
    log(`booting SUT profile=${profile}`);
    const sut = await startSut({
      mode,
      adapter,
      auth: profile === "auth",
      port: options.port,
      posts: options.posts,
      sessions: options.sessions,
      logFile: path.join(outDir, `sut-${profile}-${index + 1}.log`),
    });
    log(
      `SUT ready at ${sut.baseUrl} (${sut.fixtures.seed.posts} posts, ${sut.fixtures.seed.sessions} sessions)`,
    );
    try {
      for (const scenario of group.scenarios) {
        if (!(await reachable(sut.baseUrl))) {
          const entry = emptyReport(scenario);
          entry.error = "SUT unreachable before the scenario started; profile aborted";
          report.scenarios.push(entry);
          log(`${scenario.id}: ${entry.error}`);
          break;
        }
        await runScenario(scenario, sut.baseUrl, sut.fixtures);
      }
    } finally {
      await sut
        .stop()
        .catch((error: unknown) => log(`stopping the SUT failed: ${String(error)}`));
    }
  }
} finally {
  if (mode === "docker" || adapter === "mongo") {
    await teardownDocker().catch((error: unknown) =>
      log(`docker teardown failed: ${String(error)}`),
    );
  }
  report.finishedAt = new Date().toISOString();
  await writeReport(outDir, report);
}
log(`done: ${path.join(outDir, "report.md")}`);
