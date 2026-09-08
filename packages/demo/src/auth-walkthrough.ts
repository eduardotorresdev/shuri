import { createClient, type ShuriClient } from "@shuri/client";
import type { AuthApi } from "@shuri/sdk";
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
  auth: Pick<AuthApi, "clients">;
}

/**
 * Drives signup -> me -> logout -> login through `@shuri/client`, bound straight to `app.handler`
 * (no HTTP server involved), then provisions a client-credentials client and obtains a scoped token
 * from `/auth/token` through the same client — so booting the demo already proves both flows work
 * over plain `Request`/`Response`, and that the client package speaks them.
 * @param app - The app to drive; its `handler` and `auth.clients` are all that's needed.
 * @param port - The port the demo is served on, for the printed `curl` commands.
 * @returns The client, signed in as the machine client, for whatever the caller does next.
 */
export async function runAuthWalkthrough(
  app: WalkthroughApp,
  port: number,
): Promise<DemoClient> {
  const client: DemoClient = createClient({
    baseUrl: "http://localhost",
    fetch: (input, init) => app.handler(new Request(input, init)),
  });

  const { user } = await client.auth.signup(CREDENTIALS);
  console.log(`  [auth] signup -> 201 ${user.email}`);

  const me = await client.auth.me();
  console.log(`  [auth] me     -> 200 ${me.user.email}`);

  await client.auth.logout();
  console.log(`  [auth] logout -> 204`);

  await client.auth.login(CREDENTIALS);
  console.log(`  [auth] login  -> 200`);

  const { client: issued, clientSecret } = await app.auth.clients.create({
    name: "Demo integrator",
    roles: ["integrator"],
  });
  const grant = await client.auth.token({
    clientId: issued.clientId,
    clientSecret,
    scope: "posts:list",
  });
  console.log(`  [auth] token  -> 200 scope="${grant.scope}"`);

  const base = `http://localhost:${port}`;
  console.log(`  Auth:        curl -c jar -X POST ${base}/auth/signup \\`);
  console.log(`                 -H 'content-type: application/json' \\`);
  console.log(
    `                 -d '{"email":"you@example.com","password":"correct-horse-battery"}'`,
  );
  console.log(`               curl -b jar ${base}/auth/me`);
  console.log(`               curl -b jar -X POST ${base}/auth/logout`);
  console.log(`  M2M token:   curl -u ${issued.clientId}:${clientSecret} \\`);
  console.log(
    `                 -d 'grant_type=client_credentials&scope=posts:list' ${base}/auth/token`,
  );
  console.log(
    `               curl -H 'Authorization: Bearer ${grant.access_token}' ${base}/collections/posts`,
  );
  return client;
}
