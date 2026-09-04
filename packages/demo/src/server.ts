import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { collections } from "./collections.ts";
import { globals } from "./globals.ts";
import { runAuthWalkthrough } from "./auth-walkthrough.ts";
import { serve } from "./node-http-adapter.ts";

const port = Number(process.env["PORT"] ?? 3000);

// `cookie.secure: false` because this demo is plain HTTP: a Secure cookie is never stored by a
// browser talking to http://localhost, so the whole flow would silently do nothing.
const app = create({
  collections,
  globals,
  adapter: createMemoryAdapter(),
  auth: { cookie: { secure: false } },
});

// Subscribed before the seed below, so the boot output already shows the in-process side of the
// same bus the /events route streams from.
const unsubscribe = app.collections.posts.subscribe((event) => {
  console.log(`  [subscribe] posts ${event.type} ${event.id}`);
});
process.on("SIGINT", () => {
  unsubscribe();
  process.exit(0);
});

const author = await app.collections.authors.insert({
  name: "Ada Lovelace",
  email: "ada@example.com",
});
await app.collections.posts.insert({
  title: "Hello, Shuri",
  body: `Seeded by ${author.name} when the demo server started.`,
  published: true,
});
await app.globals.site.update({
  name: "Shuri Demo",
  tagline: "A headless CMS toolkit",
});

await runAuthWalkthrough(app, port);

serve(app.handler, port);

console.log(`Shuri demo running at http://localhost:${port}`);
console.log(`  Collections: http://localhost:${port}/collections/posts`);
console.log(`  Globals:     http://localhost:${port}/globals/site`);
console.log(`  OpenAPI doc: http://localhost:${port}/openapi.json`);
console.log(`  Docs UI:     http://localhost:${port}/docs`);
console.log(
  `  Events:      curl -N "http://localhost:${port}/events?collection=posts&events=create,delete"`,
);
