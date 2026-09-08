import { createServer } from "node:http";
import { toNodeListener } from "@shuri/sdk/node";

/**
 * Reference servers, for the same box and the same budget as the SUT: what does the fastest
 * possible Node answer cost, what does our bridge alone cost, what does a popular framework cost?
 * Every one serves the same JSON (one `posts` record) on any path.
 *
 *   BENCH_REFERENCE=node      bare node:http, Content-Length set, one write
 *   BENCH_REFERENCE=bridge    toNodeListener() around a handler that returns the record
 *   BENCH_REFERENCE=fastify   fastify with a route returning the record
 */
const kind = process.env["BENCH_REFERENCE"] ?? "node";
const port = Number(process.env["PORT"] ?? 3000);

const record = {
  title: "Post #1",
  body: "Body of post 1. Body of post 1. Body of post 1. Body of post 1. ",
  published: false,
  views: 7,
  category: "guide",
  contact: "author1@example.com",
  id: "e2b4d3d3-4d0b-43fb-abf7-70a681c43639",
};
const body = JSON.stringify(record);
const headers = { "content-type": "application/json" };

if (kind === "node") {
  const length = Buffer.byteLength(body);
  createServer((_req, res) => {
    res.writeHead(200, { ...headers, "content-length": length });
    res.end(body);
  }).listen(port, () => console.log(`[reference] node on :${port}`));
} else if (kind === "bridge") {
  const listener = toNodeListener({
    handler: async () => new Response(body, { headers }),
  });
  createServer(listener).listen(port, () =>
    console.log(`[reference] bridge on :${port}`),
  );
} else if (kind === "fastify") {
  const { default: fastify } = await import("fastify");
  const app = fastify();
  app.get("/collections/posts/:id", async () => record);
  app.get("/*", async () => record);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`[reference] fastify on :${port}`);
} else {
  throw new Error(`Unknown BENCH_REFERENCE "${kind}"`);
}
