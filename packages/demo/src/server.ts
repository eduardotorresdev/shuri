import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { collections } from "./collections.ts";
import { serve } from "./node-http-adapter.ts";

const port = Number(process.env["PORT"] ?? 3000);

const app = create({ collections, adapter: createMemoryAdapter() });

const author = await app.collections.authors.insert({ name: "Ada Lovelace", email: "ada@example.com" });
await app.collections.posts.insert({
  title: "Hello, Shuri",
  body: `Seeded by ${author.name} when the demo server started.`,
  published: true,
});

serve(app.handler, port);

console.log(`Shuri demo running at http://localhost:${port}`);
console.log(`  Collections: http://localhost:${port}/collections/posts`);
console.log(`  OpenAPI doc: http://localhost:${port}/openapi.json`);
console.log(`  Docs UI:     http://localhost:${port}/docs`);
