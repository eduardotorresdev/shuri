import type { BetterAuthPlugin } from "@shuri/better-auth";
import { samplePost, type PostInput } from "./schema.ts";

/** What the runner needs from the SUT to drive every scenario, served at `/__bench/fixtures`. */
export interface Fixtures {
  /** The first `FIXTURE_IDS` post ids, for the scenarios that read or update one record. */
  ids: string[];
  /** A `Cookie` header value for one of the seeded sessions, or `undefined` with auth off. */
  sessionCookie?: string;
  /** The credentials `POST /api/auth/sign-in/email` accepts, or `undefined` with auth off. */
  login?: { email: string; password: string };
  /** How the SUT was seeded, echoed so the report can state it. */
  seed: { posts: number; sessions: number };
}

/** How many ids the fixtures carry: enough for `setupRequest` to spread reads over the table. */
export const FIXTURE_IDS = 1000;

const CREDENTIALS = { email: "bench@example.com", password: "correct-horse-battery" };

interface SeedApp {
  collections: {
    posts: { insert(data: PostInput): Promise<{ id: string }> };
  };
  globals: {
    site: { update(data: { name: string; tagline: string }): Promise<unknown> };
  };
  handler: (request: Request) => Promise<Response>;
}

export interface SeedOptions {
  posts: number;
  sessions: number;
  /** The auth plugin the app was built with, or `undefined` with auth off. */
  auth?: BetterAuthPlugin;
}

/**
 * Seeds the SUT in-process and returns the fixtures the runner reads.
 *
 * One account signs up through better-auth's own route (one password hash, and the response
 * carries the cookie the `auth-session` scenario sends); the remaining sessions are inserted
 * through better-auth's internal adapter, one row each and no hashing. The **shape** of what's
 * seeded is what matters for the numbers — `session` holding `sessions` rows is what makes a
 * session lookup O(sessions) on an adapter with no index — not how it got there.
 * @param app - The app to seed.
 * @param options - How many posts and sessions to create, and the auth plugin if any.
 * @returns The fixtures.
 */
export async function seed(app: SeedApp, options: SeedOptions): Promise<Fixtures> {
  const ids: string[] = [];
  for (let i = 0; i < options.posts; i++) {
    const record = await app.collections.posts.insert(samplePost(i));
    if (ids.length < FIXTURE_IDS) ids.push(record.id);
  }
  await app.globals.site.update({ name: "Shuri Bench", tagline: "1 core, 1 GB" });

  const fixtures: Fixtures = {
    ids,
    seed: { posts: options.posts, sessions: options.auth ? options.sessions : 0 },
  };
  if (!options.auth) return fixtures;

  const signup = await app.handler(
    new Request(`http://sut${options.auth.basePath}/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://sut" },
      body: JSON.stringify({ ...CREDENTIALS, name: "Bench" }),
    }),
  );
  if (!signup.ok) throw new Error(`seed signup failed: ${signup.status}`);
  const { user } = (await signup.json()) as { user: { id: string } };
  fixtures.sessionCookie = signup.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

  const { internalAdapter } = await options.auth.instance().$context;
  for (let i = 1; i < options.sessions; i++) {
    await internalAdapter.createSession(user.id);
  }
  fixtures.login = CREDENTIALS;
  return fixtures;
}
