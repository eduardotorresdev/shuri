import { createServer } from "node:http";
import { apiKey } from "@better-auth/api-key";
import { betterAuthPlugin } from "@shuri/better-auth";
import { createClient } from "@shuri/client";
import { create } from "@shuri/sdk";
import { toNodeListener } from "@shuri/sdk/node";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createAdminHandler } from "@shuri/ui";
import { collections } from "./collections.ts";
import { globals } from "./globals.ts";
import { runAuthWalkthrough, type DemoClient } from "./auth-walkthrough.ts";

const port = Number(process.env["PORT"] ?? 3000);

// The credentials the seeded administrator signs in with. Hard-coded because this demo throws its
// whole store away on exit; a real app would never carry a password in source.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "correct horse battery staple";

// `SHURI_SETUP_TOKEN` gates the first-run form — set it and the form asks for it too. The demo seeds
// an administrator below, so the form only appears if that seed is removed.
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
    // Machine-to-machine: a request carrying a key (`x-api-key`, or a bearer) acts as a `client`
    // principal with exactly the scopes the key's permissions name — see the seed below.
    plugins: [apiKey()],
  },
  // Whoever completes setup becomes the administrator; `authorize` reads exactly this back.
  setup: { fields: { role: "admin" } },
});

// `authorize` is what makes the admin an admin. Signup is open, so without it every visitor who
// registers would be an editor. Reads stay public (`@shuri/ui`'s default) and writes to
// `/collections` and `/globals` take that session.
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
});

// The PocketBase side of hooks: registered at runtime, typed per slug, run after the ones the
// schema declares (see collections.ts). Registered before the seed, so booting already exercises it.
app.hooks.onCollection("posts", "afterChange", ({ operation, doc, previousDoc }) => {
  const change = previousDoc
    ? `"${previousDoc.title}" -> "${doc.title}"`
    : `"${doc.title}"`;
  console.log(`  [hooks] posts afterChange (${operation}) ${doc.id} ${change}`);
});
app.hooks.onCollection("posts", "afterDelete", ({ id, doc }) => {
  console.log(
    `  [hooks] posts afterDelete ${id}${doc ? ` "${doc.title}"` : " (unknown id)"}`,
  );
});

const author = await app.collections.authors.insert({
  name: "Ada Lovelace",
  email: "ada@example.com",
});
await app.collections.posts.insert({
  title: "  Hello, Shuri  ",
  body: `Seeded by ${author.name} when the demo server started.`,
  status: "published",
  author: author.id,
  readingMinutes: 3,
  published: true,
});
// The one account that passes `authorize` above, created by completing the first-run flow on the
// boot's behalf: the same route the setup form posts to, so the password goes through better-auth's
// hasher and `role: "admin"` is stamped exactly as it would be for whoever filled the form in.
const setup = await ba.setupSource.create(
  { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Admin" },
  new Request(`http://localhost:${port}/admin/setup`),
);
if (!setup.ok) throw new Error(`seeding the administrator failed: ${setup.status}`);
const { user: admin } = (await setup.json()) as { user: { id: string } };

// A machine credential beside the human one: owned by the administrator, but acting in its own
// name with only `posts` reads and writes — `site:update` is not in its permissions, so a script
// holding it gets 403 there, however privileged its owner. The plaintext is readable once, here.
const integration = await ba.apiKeys.create({
  name: "demo-integration",
  userId: admin.id,
  permissions: { posts: ["list", "view", "create", "update"] },
});

await app.globals.site.update({
  name: "Shuri Demo",
  tagline: "A headless CMS toolkit",
});

await runAuthWalkthrough(app, port);

createServer(toNodeListener(app)).listen(port);

console.log(`Shuri demo running at http://localhost:${port}`);
console.log(`  Admin UI:    http://localhost:${port}/admin`);
console.log(`               entre com ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
if (setupToken) console.log(`               token de setup: ${setupToken}`);
console.log(`  Auth routes: http://localhost:${port}${ba.basePath}/*`);
console.log(
  `  API key:     curl -H 'x-api-key: ${integration.key}' http://localhost:${port}/collections/posts`,
);
console.log(`  Collections: http://localhost:${port}/collections/posts`);
console.log(`  Globals:     http://localhost:${port}/globals/site`);
console.log(`  OpenAPI doc: http://localhost:${port}/openapi.json`);
console.log(`  Docs UI:     http://localhost:${port}/docs`);
console.log(
  `  Events:      curl -N "http://localhost:${port}/events?collection=posts&events=create,delete"`,
);

// The client side of the same stream, over a real socket this time: `@shuri/client` subscribes to
// `posts` on the server just started, and the SDK write below comes back as a frame — the SSE path
// end to end, from the hooks feeding it to the parser reading it.
const client: DemoClient = createClient({ baseUrl: `http://localhost:${port}` });
const unsubscribe = client.collections.posts.subscribe(
  (event) => {
    const detail =
      event.type === "delete" ? event.id : `${event.id} "${event.record.title}"`;
    console.log(`  [client] posts ${event.type} ${detail}`);
  },
  {
    onOpen: () => {
      console.log("  [client] subscribed to posts over SSE");
      void app.collections.posts.insert({
        title: "Seen from the client",
        published: false,
      });
    },
    onError: (error) => console.error("  [client] stream error", error),
  },
);
process.on("SIGINT", () => {
  unsubscribe();
  process.exit(0);
});
