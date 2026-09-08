import type { Fixtures } from "../sut/seed.ts";

export type { Fixtures };

/**
 * Polls `/__bench/fixtures` until the SUT answers: the route only exists once seeding is done,
 * so a 200 here means the SUT is ready for load. Seeding 10k posts into Mongo takes a while, hence
 * the generous default.
 * @param baseUrl - The SUT's origin.
 * @param timeoutMs - How long to keep trying. Defaults to 10 minutes.
 * @returns The fixtures.
 */
export async function waitForFixtures(
  baseUrl: string,
  timeoutMs = 600_000,
): Promise<Fixtures> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/__bench/fixtures`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return (await response.json()) as Fixtures;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`SUT at ${baseUrl} never became ready: ${String(lastError)}`);
}
