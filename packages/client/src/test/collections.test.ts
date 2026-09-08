import { describe, expect, it } from "vitest";
import { ClientError } from "../errors.js";
import { createTestApp } from "./support.js";

describe("client.collections", () => {
  it("creates, reads, updates and deletes through the REST routes, typed from the schema", async () => {
    const { client } = createTestApp();
    const posts = client.collections.posts;

    const created = await posts.create({ title: "Hello", views: 1 });
    const title: string = created.title;
    const views: number | undefined = created.views;
    expect({ title, views, id: typeof created.id }).toEqual({
      title: "Hello",
      views: 1,
      id: "string",
    });

    expect(await posts.get(created.id)).toEqual(created);
    expect(await posts.update(created.id, { views: 2 })).toEqual({
      ...created,
      views: 2,
    });
    expect(await posts.list()).toEqual([{ ...created, views: 2 }]);

    await posts.delete(created.id);
    expect(await posts.list()).toEqual([]);

    // @ts-expect-error "title" is required
    void posts.create({ views: 1 }).catch(() => {});
    // @ts-expect-error unknown collection
    void client.collections.nope;
  });

  it("serializes a query the way the server reads it", async () => {
    const { client } = createTestApp();
    const posts = client.collections.posts;
    await posts.create({ title: "B", views: 2 });
    await posts.create({ title: "A", views: 1 });
    await posts.create({ title: "C", views: 3 });

    const listed = await posts.list({
      where: { views: { op: "gte", value: 2 } },
      orderBy: [{ field: "title", direction: "desc" }],
      limit: 1,
      offset: 0,
    });

    expect(listed.map((post) => post.title)).toEqual(["C"]);
  });

  it("throws a ClientError carrying the status and the server's issues", async () => {
    const { client } = createTestApp();

    const missing = client.collections.posts.get("nope");
    await expect(missing).rejects.toBeInstanceOf(ClientError);
    await expect(missing).rejects.toMatchObject({ status: 404 });

    const invalid = client.collections.posts.create({ title: "x", views: -1 });
    await expect(invalid).rejects.toMatchObject({
      status: 400,
      issues: [expect.objectContaining({ path: expect.stringContaining("views") })],
    });
  });

  it("honors relocated base paths", async () => {
    const relocated = createTestApp({ client: { paths: { collections: "/api" } } });

    // The server still mounts at /collections, so /api answers 404 — proof the path was used.
    await expect(relocated.client.collections.posts.list()).rejects.toMatchObject({
      status: 404,
    });
  });
});
