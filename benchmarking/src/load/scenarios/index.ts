import { runLoad, type CannonRequest, type LoadResult } from "../autocannon.ts";
import type { Fixtures } from "../fixtures.ts";
import type { Row, ScenarioReport } from "../report.ts";
import type { StatsSummary } from "../stats.ts";

/** Which SUT profile a scenario needs: `auth` boots with `BENCH_AUTH=on`, `open` without. */
export type SutProfile = "open" | "auth";

export interface ScenarioContext {
  baseUrl: string;
  fixtures: Fixtures;
  /** The sweep, for scenarios that run at every concurrency. */
  connections: number[];
  /** The subscriber levels for `sse-fanout`. */
  subscribers: number[];
  duration: number;
  warmup: number;
  log(message: string): void;
  /** Called after every row, so the report on disk is always current. */
  onRow(row: Row): Promise<void>;
}

export interface Scenario {
  id: string;
  sut: SutProfile;
  description: string;
  columns: string[];
  run(context: ScenarioContext): Promise<void>;
}

/** Concurrency for the scenarios that don't sweep: past the knee of every read route, short of the cliff. */
export const DEFAULT_CONNECTIONS = 64;

/** The columns every autocannon-driven scenario reports. */
export const HTTP_COLUMNS = [
  "c",
  "rps",
  "p50 ms",
  "p99 ms",
  "max ms",
  "errors",
  "non2xx",
  "rss max MB",
  "heap max MB",
  "ELU",
] as const;

/**
 * One report row from one measurement.
 * @param c - The concurrency, or a label for it.
 * @param load - autocannon's numbers.
 * @param stats - The SUT's numbers.
 * @returns The row.
 */
export function toRow(c: number | string, load: LoadResult, stats: StatsSummary): Row {
  return {
    c,
    rps: load.rps,
    "p50 ms": load.p50,
    "p99 ms": load.p99,
    "max ms": load.max,
    errors: load.errors,
    non2xx: load.non2xx,
    "rss max MB": stats.rssMaxMB,
    "heap max MB": stats.heapMaxMB,
    ELU: stats.eluAvg,
  };
}

export interface HttpScenarioSpec {
  id: string;
  sut: SutProfile;
  description: string;
  /** `"sweep"` runs the whole `--connections` list; a list runs exactly those; absent runs `DEFAULT_CONNECTIONS`. */
  connections?: "sweep" | number[];
  /** The request mix, built from the fixtures once per concurrency. */
  requests(fixtures: Fixtures): CannonRequest[];
}

/**
 * The shape most scenarios share: for each concurrency, warmup, measure with stats, one row.
 * @param spec - What to fire and where.
 * @returns The scenario.
 */
export function httpScenario(spec: HttpScenarioSpec): Scenario {
  return {
    id: spec.id,
    sut: spec.sut,
    description: spec.description,
    columns: [...HTTP_COLUMNS],
    async run(context) {
      const levels =
        spec.connections === "sweep"
          ? context.connections
          : (spec.connections ?? [DEFAULT_CONNECTIONS]);
      for (const connections of levels) {
        context.log(`${spec.id} c=${connections}`);
        const { load, stats } = await runLoad({
          url: context.baseUrl,
          statsUrl: `${context.baseUrl}/__bench/stats`,
          connections,
          duration: context.duration,
          warmup: context.warmup,
          requests: spec.requests(context.fixtures),
          title: `${spec.id} c=${connections}`,
        });
        await context.onRow(toRow(connections, load, stats));
      }
    },
  };
}

/**
 * The report entry a scenario starts with; rows are appended as they come.
 * @param scenario - The scenario about to run.
 * @returns The empty report entry.
 */
export function emptyReport(scenario: Scenario): ScenarioReport {
  return {
    id: scenario.id,
    sut: scenario.sut,
    description: scenario.description,
    columns: scenario.columns,
    rows: [],
  };
}
