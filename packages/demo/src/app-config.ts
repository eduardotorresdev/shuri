import { apiKey } from "@better-auth/api-key";
import { betterAuthPlugin } from "@shuri/better-auth";
import type { CreateConfig } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createAdminHandler } from "@shuri/ui";
import { collections } from "./collections.ts";
import { globals } from "./globals.ts";

// The app's configuration, with no side effects beyond building plain objects: `shuri.migrate.ts`
// imports it to resolve the schema without booting a server, and `server.ts` boots it with `create()`.

export const port = Number(process.env["PORT"] ?? 3000);

// `SHURI_SETUP_TOKEN` gates the first-run form — set it and the form asks for it too. The demo seeds
// an administrator at boot, so the form only appears if that seed is removed.
export const setupToken = process.env["SHURI_SETUP_TOKEN"];

export const ba = betterAuthPlugin({
  options: {
    baseURL: `http://localhost:${port}`,
    // Hard-coded because this demo throws its whole store away on exit.
    secret: "demo-secret-at-least-32-characters-long",
    emailAndPassword: { enabled: true },
    // Declared to better-auth, not only stamped on the row: better-auth parses a user against its
    // own schema on the way out, so a column it does not know about never reaches a session — and
    // `authorize` below would never see it. Declaring it here also puts it on the collection
    // `betterAuthCollections` derives (and so on the migrations: changing these options changes the
    // schema, which `shuri-migrate check` reports as drift until a migration records it).
    user: {
      additionalFields: { role: { type: "string", required: false, input: false } },
    },
    // Plain HTTP: a Secure cookie is never stored by a browser talking to http://localhost.
    advanced: { useSecureCookies: false },
    // Machine-to-machine: a request carrying a key (`x-api-key`, or a bearer) acts as a `client`
    // principal with exactly the scopes the key's permissions name — see the seed in server.ts.
    plugins: [apiKey()],
  },
  // Whoever completes setup becomes the administrator; `authorize` reads exactly this back.
  setup: { fields: { role: "admin" } },
});

// `authorize` is what makes the admin an admin. Signup is open, so without it every visitor who
// registers would be an editor. Reads stay public (`@shuri/ui`'s default) and writes to
// `/collections` and `/globals` take that session.
export const appConfig = {
  collections,
  globals,
  adapter: createMemoryAdapter(),
  plugins: [
    ba,
    {
      name: "admin",
      handlers: () => [
        createAdminHandler(
          { collections, globals },
          {
            auth: {
              auth: ba.sessionSource,
              basePath: ba.basePath,
              authorize: (session) => session.user["role"] === "admin",
              // A request holding an API key is not the guard's to refuse: `@shuri/api` judges it
              // by the key's scopes, and the guard only speaks sessions.
              exempt: ba.carriesApiKey,
              setup: {
                source: ba.setupSource,
                ...(setupToken ? { token: setupToken } : {}),
              },
            },
          },
        ),
      ],
    },
  ],
} satisfies CreateConfig<typeof collections, typeof globals>;
