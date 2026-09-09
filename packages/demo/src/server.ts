import { createServer } from "node:http";
import { createClient } from "@shuri/client";
import { create } from "@shuri/sdk";
import { toNodeListener } from "@shuri/sdk/node";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createAdminHandler } from "@shuri/ui";
import { collections } from "./collections.ts";
import { globals } from "./globals.ts";
import { runAuthWalkthrough, type DemoClient } from "./auth-walkthrough.ts";

const port = Number(process.env["PORT"] ?? 3000);

// The credentials the seeded admin user signs in with. Hard-coded because this demo throws its
// whole store away on exit; a real app would never carry a password in source.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "correct horse battery staple";

// `cookie.secure: false` because this demo is plain HTTP: a Secure cookie is never stored by a
// browser talking to http://localhost, so the whole flow would silently do nothing. `clients.roles`
// is what a machine client's token can be scoped to: `posts:*` expands to every op of `posts`.
//
// `handlers` is a function so the admin can be handed the `AuthApi` this very call builds — it
// cannot exist beforehand, since it needs the store.
//
// `authorize` is what makes the admin an admin. Signup here is open, so without it every visitor
// who registers would be an editor. It matches on email because `@shuri/auth`'s `users` collection
// declares no role field; a real app adds one and checks that instead.
const app = create({
  collections,
  globals,
  adapter: createMemoryAdapter(),
  auth: {
    cookie: { secure: false },
    clients: { roles: { integrator: ["posts:*"] } },
  },
  handlers: ({ auth }) => [
    createAdminHandler(
      { collections, globals },
      { auth: { auth, authorize: (session) => session.user.email === ADMIN_EMAIL } },
    ),
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
// The one account that passes `authorize` above. Created through `auth.signUp` rather than by
// inserting into `users`, so the password goes through the same hasher a real signup does.
await app.auth.signUp({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

await app.globals.site.update({
  name: "Shuri Demo",
  tagline: "A headless CMS toolkit",
});

await runAuthWalkthrough(app, port);

createServer(toNodeListener(app)).listen(port);

console.log(`Shuri demo running at http://localhost:${port}`);
console.log(`  Admin UI:    http://localhost:${port}/admin`);
console.log(`               entre com ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
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
