import { createServer } from "node:http";
import { createClient } from "@shuri/client";
import { migrateUp, parseBundle } from "@shuri/migrate";
import { create, resolveSchema } from "@shuri/sdk";
import { toNodeListener } from "@shuri/sdk/node";
import migrations from "../migrations/index.ts";
import { appConfig, ba, port, setupToken } from "./app-config.ts";
import { runAuthWalkthrough, type DemoClient } from "./auth-walkthrough.ts";

// The credentials the seeded administrator signs in with. Hard-coded because this demo throws its
// whole store away on exit; a real app would never carry a password in source.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "correct horse battery staple";

// Creates the schema in the (in-memory) store before anything is written. A production deployment
// would run `shuri-migrate up` as a deploy step and call `assertMigrated` here instead.
await migrateUp({
  files: parseBundle(migrations),
  driver: appConfig.adapter.migrations,
  schema: resolveSchema(appConfig),
});

const app = create(appConfig);

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
