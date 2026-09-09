import { createClient, type ShuriClient } from "@shuri/client";
import type { collections } from "./collections.ts";
import type { globals } from "./globals.ts";

/** The one credential pair the walkthrough registers, printed alongside the `curl` equivalents. */
const CREDENTIALS = { email: "ada@example.com", password: "correct-horse-battery" };

export type DemoClient = ShuriClient<{
  collections: typeof collections;
  globals: typeof globals;
}>;

interface WalkthroughApp {
  handler: (request: Request) => Promise<Response>;
}

/**
 * Drives signup -> me -> logout -> login through `@shuri/client`, bound straight to `app.handler`
 * (no HTTP server involved) — so booting the demo already proves the flow works over plain
 * `Request`/`Response`, and that the client package speaks better-auth's routes.
 * @param app - The app to drive; its `handler` is all that's needed.
 * @param port - The port the demo is served on, for the printed `curl` commands.
 * @returns The client, signed in, for whatever the caller does next.
 */
export async function runAuthWalkthrough(
  app: WalkthroughApp,
  port: number,
): Promise<DemoClient> {
  const client: DemoClient = createClient({
    baseUrl: `http://localhost:${port}`,
    fetch: (input, init) => app.handler(new Request(input, init)),
  });

  const { user } = await client.auth.signup({ ...CREDENTIALS, name: "Ada" });
  console.log(`  [auth] signup -> 200 ${user.email}`);

  const me = await client.auth.me();
  console.log(`  [auth] me     -> 200 ${me.user.email}`);

  await client.auth.logout();
  console.log(`  [auth] logout -> 200`);

  await client.auth.login(CREDENTIALS);
  console.log(`  [auth] login  -> 200`);

  const base = `http://localhost:${port}`;
  console.log(`  Auth:        curl -c jar -X POST ${base}/api/auth/sign-up/email \\`);
  console.log(
    `                 -H 'content-type: application/json' -H 'origin: ${base}' \\`,
  );
  console.log(
    `                 -d '{"email":"you@example.com","password":"correct-horse-battery","name":"You"}'`,
  );
  console.log(`               curl -b jar ${base}/api/auth/get-session`);
  console.log(
    `               curl -b jar -X POST -H 'origin: ${base}' ${base}/api/auth/sign-out`,
  );
  return client;
}
