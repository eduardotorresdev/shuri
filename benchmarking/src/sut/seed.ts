import type { AuthApi } from "@shuri/sdk";
import { samplePost, type PostInput } from "./schema.ts";

/** What the runner needs from the SUT to drive every scenario, served at `/__bench/fixtures`. */
export interface Fixtures {
  /** The first `FIXTURE_IDS` post ids, for the scenarios that read or update one record. */
  ids: string[];
  /** A `Cookie` header value for one of the seeded sessions, or `undefined` with auth off. */
  sessionCookie?: string;
  /** A `Bearer` client token scoped to `posts:*`, or `undefined` with auth off. */
  clientToken?: string;
  /** The credentials `POST /auth/login` accepts, or `undefined` with auth off. */
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
  auth: AuthApi | undefined;
}

export interface SeedOptions {
  posts: number;
  sessions: number;
}

/**
 * Seeds the SUT in-process and returns the fixtures the runner reads.
 *
 * Deliberately not through the public API: 1k sessions via `POST /auth/login` would cost 1k PBKDF2
 * runs (600k iterations each, minutes on one core), while `app.auth.createSession` is one hash of
 * the password total and then a SHA-256 per session. The **shape** of what's seeded is what
 * matters for the numbers — `_sessions` holding `sessions` rows is what makes the auth scan
 * O(sessions) — not how it got there.
 * @param app - The app to seed.
 * @param options - How many posts and sessions to create.
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
    seed: { posts: options.posts, sessions: app.auth ? options.sessions : 0 },
  };
  if (!app.auth) return fixtures;

  const { user, token: firstToken } = await app.auth.signUp(CREDENTIALS);
  let token = firstToken;
  for (let i = 1; i < options.sessions; i++) {
    ({ token } = await app.auth.createSession(user.id));
  }
  fixtures.sessionCookie = `shuri_session=${encodeURIComponent(token)}`;

  const { client } = await app.auth.clients.create({
    name: "Bench integrator",
    roles: ["integrator"],
  });
  fixtures.clientToken = (await app.auth.issueClientToken(client.clientId)).token;
  fixtures.login = CREDENTIALS;
  return fixtures;
}
