/** What the SUT reports at `GET /__bench/stats`. Mirrors `sut/server.ts`. */
export interface SutStats {
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
  eventLoopUtilization: number;
  uptimeMs: number;
}

/** The SUT's memory and event loop over one measurement, sampled once a second. */
export interface StatsSummary {
  rssMaxMB: number;
  heapMaxMB: number;
  /** Peak event loop utilization over any one-second window, 0..1. */
  eluMax: number;
  /** Mean event loop utilization across the samples, 0..1. */
  eluAvg: number;
  samples: number;
  /** Samples that failed or timed out — a saturated SUT can starve the stats route too. */
  failures: number;
}

const MB = 1024 * 1024;

/**
 * Reads one stats sample. A short timeout: under a 1024-connection sweep the stats request queues
 * behind the load, and a sample that arrives late is a sample about a different second.
 * @param statsUrl - `${baseUrl}/__bench/stats`.
 * @returns The sample.
 */
export async function fetchStats(statsUrl: string): Promise<SutStats> {
  const response = await fetch(statsUrl, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`stats: HTTP ${response.status}`);
  return (await response.json()) as SutStats;
}

/**
 * Samples `/__bench/stats` every `intervalMs` until stopped, keeping the peaks. Memory is read
 * from inside the process rather than from `docker stats` so the local and docker modes report
 * the same thing.
 * @param statsUrl - `${baseUrl}/__bench/stats`.
 * @param intervalMs - Sampling period. Defaults to 1000.
 * @returns A handle whose `stop` resolves to the summary.
 */
export function startSampling(
  statsUrl: string,
  intervalMs = 1_000,
): { stop(): Promise<StatsSummary> } {
  const summary: StatsSummary = {
    rssMaxMB: 0,
    heapMaxMB: 0,
    eluMax: 0,
    eluAvg: 0,
    samples: 0,
    failures: 0,
  };
  let eluTotal = 0;
  let inFlight: Promise<void> = Promise.resolve();

  const sample = async (): Promise<void> => {
    try {
      const stats = await fetchStats(statsUrl);
      summary.samples += 1;
      summary.rssMaxMB = Math.max(summary.rssMaxMB, stats.memory.rss / MB);
      summary.heapMaxMB = Math.max(summary.heapMaxMB, stats.memory.heapUsed / MB);
      summary.eluMax = Math.max(summary.eluMax, stats.eventLoopUtilization);
      eluTotal += stats.eventLoopUtilization;
    } catch {
      summary.failures += 1;
    }
  };

  // The first sample resets the SUT's ELU window, so every later delta covers load time only.
  inFlight = fetchStats(statsUrl).then(
    () => undefined,
    () => undefined,
  );
  const timer = setInterval(() => {
    inFlight = inFlight.then(sample);
  }, intervalMs);

  return {
    async stop() {
      clearInterval(timer);
      await inFlight;
      await sample();
      summary.eluAvg = summary.samples > 0 ? eluTotal / summary.samples : 0;
      return summary;
    },
  };
}
