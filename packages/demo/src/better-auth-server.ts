import { betterAuthPlugin } from "@shuri/better-auth";
import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createAdminHandler } from "@shuri/ui";
import { collections } from "./collections.ts";
import { globals } from "./globals.ts";
import { serve } from "./node-http-adapter.ts";

/**
 * The same demo app as `server.ts`, with `@shuri/better-auth` in place of `@shuri/auth`.
 *
 * Run it with `pnpm --filter @shuri/demo start:better-auth`. It exists to show that swapping the auth
 * implementation touches the wiring and nothing else: the collections, the globals and the admin are
 * the very same ones `server.ts` uses.
 */
const port = Number(process.env["PORT"] ?? 3000);

// No seeded account and no password in source: the admin has none until somebody creates the first
// one through the setup form. `SHURI_SETUP_TOKEN` gates it — set it and the form asks for it too.
const setupToken = process.env["SHURI_SETUP_TOKEN"];

const ba = betterAuthPlugin({
  options: {
    baseURL: `http://localhost:${port}`,
    // Hard-coded because this demo throws its whole store away on exit.
    secret: "demo-secret-at-least-32-characters-long",
    emailAndPassword: { enabled: true },
    // Declared to better-auth, not only stamped on the row: better-auth parses a user against its
    // own schema on the way out, so a column it does not know about never reaches a session — and
    // `authorize` below would never see it. Declaring it here also puts it on the collection
    // `betterAuthCollections` derives.
    user: {
      additionalFields: { role: { type: "string", required: false, input: false } },
    },
    // Plain HTTP: a Secure cookie is never stored by a browser talking to http://localhost.
    advanced: { useSecureCookies: false },
  },
  // Whoever completes setup becomes the administrator; `authorize` reads exactly this back.
  setup: { fields: { role: "admin" } },
});

const app = create({
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
              // better-auth's own credential routes, which are not `@shuri/auth`'s.
              signInPath: `${ba.basePath}/sign-in/email`,
              signOutPath: `${ba.basePath}/sign-out`,
              // The first-run form stamps this role on the account it creates. Signup stays open,
              // so anyone else who registers is authenticated but told they have no access.
              authorize: (session) => session.user["role"] === "admin",
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
});

const author = await app.collections.authors.insert({
  name: "Ada Lovelace",
  email: "ada@example.com",
});
await app.collections.posts.insert({
  title: "Hello, better-auth",
  body: `Seeded by ${author.name} when the demo server started.`,
  status: "published",
  author: author.id,
  readingMinutes: 3,
  published: true,
});
await app.globals.site.update({ name: "Shuri Demo", tagline: "A headless CMS toolkit" });

serve(app.handler, port);

console.log(`Shuri demo (better-auth) running at http://localhost:${port}`);
console.log(`  Admin UI:    http://localhost:${port}/admin`);
console.log("               primeiro acesso: crie a conta pelo formulário de setup");
if (setupToken) console.log(`               token de setup: ${setupToken}`);
console.log(`  Auth routes: http://localhost:${port}${ba.basePath}/*`);
console.log(`  Collections: http://localhost:${port}/collections/posts`);
