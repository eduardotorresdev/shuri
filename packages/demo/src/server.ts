import { createServer } from "node:http";
import { createClient } from "@shuri/client";
import { create } from "@shuri/sdk";
import { toNodeListener } from "@shuri/sdk/node";
import { createMemoryAdapter } from "@shuri/store-memory";
import { collections } from "./collections.ts";
import { globals } from "./globals.ts";
import { runAuthWalkthrough, type DemoClient } from "./auth-walkthrough.ts";

const port = Number(process.env["PORT"] ?? 3000);

// `cookie.secure: false` because this demo is plain HTTP: a Secure cookie is never stored by a
// browser talking to http://localhost, so the whole flow would silently do nothing. `clients.roles`
// is what a machine client's token can be scoped to: `posts:*` expands to every op of `posts`.
const app = create({
  collections,
  globals,
  adapter: createMemoryAdapter(),
  auth: {
    cookie: { secure: false },
    clients: { roles: { integrator: ["posts:*"] } },
  },
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
  published: true,
});
await app.globals.site.update({
  name: "Shuri Demo",
  tagline: "A headless CMS toolkit",
});

await runAuthWalkthrough(app, port);

createServer(toNodeListener(app)).listen(port);

console.log(`Shuri demo running at http://localhost:${port}`);
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
