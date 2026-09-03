import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { collections } from "./collections.ts";
import { globals } from "./globals.ts";
import { serve } from "./node-http-adapter.ts";

const port = Number(process.env["PORT"] ?? 3000);

const app = create({ collections, globals, adapter: createMemoryAdapter() });

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

serve(app.handler, port);

console.log(`Shuri demo running at http://localhost:${port}`);
console.log(`  Collections: http://localhost:${port}/collections/posts`);
console.log(`  Globals:     http://localhost:${port}/globals/site`);
console.log(`  OpenAPI doc: http://localhost:${port}/openapi.json`);
console.log(`  Docs UI:     http://localhost:${port}/docs`);
