import { describe, expect, it } from "vitest";
import { createAdminClient, encodeQuery, fetchAdminSchema } from "./client.js";
import { AdminRequestError, issuesByField } from "./errors.js";
import type { AdminSchema } from "./schema.js";

const schema: Pick<AdminSchema, "api"> = {
  api: { collections: "/collections", globals: "/globals", events: "/events" },
};

/**
 * Records every call and answers with whatever the test queued, so no server is involved.
 * @param responses - The responses to answer with, in order.
 * @returns The recorded calls and the `fetch` to hand the client.
 */
function stubFetch(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return responses.shift() ?? new Response("{}", { status: 200 });
  };
  return { calls, fetch };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("encodeQuery", () => {
  it("sends limit and offset as numbers and the rest as JSON, the way parseQuery reads them", () => {
    const params = encodeQuery({
      limit: 10,
      offset: 20,
      where: { published: { op: "eq", value: true } },
      orderBy: [{ field: "title", direction: "desc" }],
    });

    expect(params.get("limit")).toBe("10");
    expect(params.get("offset")).toBe("20");
    expect(JSON.parse(params.get("where") ?? "")).toEqual({
      published: { op: "eq", value: true },
    });
    expect(JSON.parse(params.get("orderBy") ?? "")).toEqual([
      { field: "title", direction: "desc" },
    ]);
  });

  it("leaves empty parts out rather than sending them blank", () => {
    expect([...encodeQuery({ where: {}, orderBy: [] })]).toEqual([]);
    expect([...encodeQuery()]).toEqual([]);
  });
});

describe("createAdminClient", () => {
  it("reads a collection off the base path the schema advertises", async () => {
    const { calls, fetch } = stubFetch([json([{ id: "1" }])]);

    const records = await createAdminClient(schema, { fetch }).list("posts", {
      limit: 2,
    });

    expect(calls[0]?.url).toBe("/collections/posts?limit=2");
    expect(records).toEqual([{ id: "1" }]);
  });

  it("prefixes the origin when the admin is embedded in a different app", async () => {
    const { calls, fetch } = stubFetch([json({ id: "1" })]);

    await createAdminClient(schema, { fetch, origin: "https://cms.example.com" }).get(
      "posts",
      "1",
    );

    expect(calls[0]?.url).toBe("https://cms.example.com/collections/posts/1");
  });

  it("sends a write as JSON", async () => {
    const { calls, fetch } = stubFetch([json({ id: "1", title: "Oi" }, 201)]);

    await createAdminClient(schema, { fetch }).create("posts", { title: "Oi" });

    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"title":"Oi"}');
  });

  it("survives a 204, which has no body to parse", async () => {
    const { fetch } = stubFetch([new Response(null, { status: 204 })]);

    await expect(
      createAdminClient(schema, { fetch }).remove("posts", "1"),
    ).resolves.toBeUndefined();
  });

  it("turns a validation failure into an error carrying the issues", async () => {
    const { fetch } = stubFetch([
      json(
        {
          error: "posts.title: is required",
          issues: [{ path: "title", message: "is required" }],
        },
        400,
      ),
    ]);

    const failure = createAdminClient(schema, { fetch }).create("posts", {});

    await expect(failure).rejects.toBeInstanceOf(AdminRequestError);
    await expect(failure).rejects.toMatchObject({
      status: 400,
      issues: [{ path: "title", message: "is required" }],
    });
  });

  it("still names the status when the body isn't the JSON we expect", async () => {
    const { fetch } = stubFetch([new Response("<html>502</html>", { status: 502 })]);

    await expect(createAdminClient(schema, { fetch }).list("posts")).rejects.toThrow(
      "Request failed (502)",
    );
  });
});

describe("fetchAdminSchema", () => {
  it("reads the document from {basePath}/schema.json", async () => {
    const { calls, fetch } = stubFetch([json({ title: "Admin" })]);

    await fetchAdminSchema("/admin", { fetch });

    expect(calls[0]?.url).toBe("/admin/schema.json");
  });

  it("fails loudly when the admin isn't mounted where it was asked for", async () => {
    const { fetch } = stubFetch([json({ error: "Not found" }, 404)]);

    await expect(fetchAdminSchema("/admin", { fetch })).rejects.toBeInstanceOf(
      AdminRequestError,
    );
  });
});

describe("issuesByField", () => {
  it("indexes issues by the field they belong to, keeping the first per field", () => {
    const error = new AdminRequestError(400, "invalid", [
      { path: "title", message: "is required" },
      { path: "title", message: "must be a string" },
      { path: "tags.0", message: "must be one of a, b" },
    ]);

    expect(issuesByField(error)).toEqual({
      title: "is required",
      tags: "must be one of a, b",
    });
  });

  it("has nothing to say about an error that isn't a request failure", () => {
    expect(issuesByField(new Error("offline"))).toEqual({});
  });
});
