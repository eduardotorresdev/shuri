import type { Env, Outcome } from "../types.js";
import { flagOption } from "./shared.js";

/**
 * `unlock [--force]`: shows who holds the migration lock; `--force` releases it (for a crashed holder).
 * @param env - Parsed command line.
 * @returns Exit 0 when free or released; 5 when it is held and `--force` was not given.
 */
export async function unlock(env: Env): Promise<Outcome> {
  const driver = await (await env.project()).driver();
  const info = await driver.lockInfo();
  if (!info) return { text: "no lock is held", result: { held: false } };
  const held = `held by ${info.holder}, expires ${info.expiresAt}`;
  if (!flagOption(env, "force")) {
    return {
      exit: 5,
      text: `lock ${held}\nif the holder is gone, run \`shuri-migrate unlock --force\``,
      result: { held: true, ...info, released: false },
    };
  }
  await driver.forceUnlock();
  return {
    text: `released the lock (was ${held})`,
    result: { held: true, ...info, released: true },
  };
}
