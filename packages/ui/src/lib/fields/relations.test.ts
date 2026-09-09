import type { Field } from "@shuri/core";
import { describe, expect, it } from "vitest";
import type { AdminClient, AdminSchema } from "$shared/index.js";
import { loadRelationOptions, relationLabels } from "./relations.js";

const schema = {
  title: "Admin",
  basePath: "/admin",
  api: { collections: "/collections", globals: "/globals", events: "/events" },
  collections: [
    {
      slug: "authors",
      title: "Authors",
      singular: "Author",
      plural: "Authors",
      fields: [],
      labelField: "name",
    },
  ],
  globals: [],
} satisfies AdminSchema;

/**
 * Records which slugs were listed, so the test can assert on requests, not only on results.
 * @param records - The records each slug answers with.
 * @returns The recorded slugs and the client to hand the loader.
 */
function stubClient(records: Record<string, Record<string, unknown>[]>) {
  const listed: string[] = [];
  const client = {
    async list(slug: string) {
      listed.push(slug);
      return (records[slug] ?? []) as never;
    },
  } as unknown as AdminClient;
  return { listed, client };
}

const authorRef: Field = { type: "relation", name: "author", collection: "authors" };
const reviewerRef: Field = { type: "relation", name: "reviewer", collection: "authors" };

describe("loadRelationOptions", () => {
  it("labels each option through the referenced collection's own label field", async () => {
    const { client } = stubClient({ authors: [{ id: "a1", name: "Ada" }] });

    const options = await loadRelationOptions(client, schema, [authorRef]);

    expect(options["authors"]).toEqual([{ value: "a1", label: "Ada" }]);
  });

  it("fetches a collection once however many fields point at it", async () => {
    const { listed, client } = stubClient({ authors: [] });

    await loadRelationOptions(client, schema, [authorRef, reviewerRef]);

    expect(listed).toEqual(["authors"]);
  });

  it("asks for nothing when the form has no relation field", async () => {
    const { listed, client } = stubClient({});

    const options = await loadRelationOptions(client, schema, [
      { type: "text", name: "title" },
    ]);

    expect(listed).toEqual([]);
    expect(options).toEqual({});
  });

  it("skips a collection the admin doesn't serve, rather than requesting a 404", async () => {
    const { listed, client } = stubClient({});

    const options = await loadRelationOptions(client, schema, [
      { type: "relation", name: "session", collection: "_sessions" },
    ]);

    expect(listed).toEqual([]);
    expect(options["_sessions"]).toEqual([]);
  });
});

describe("relationLabels", () => {
  it("keys the loaded options by id, for resolving a table's cells", () => {
    expect(relationLabels({ authors: [{ value: "a1", label: "Ada" }] })).toEqual({
      authors: { a1: "Ada" },
    });
  });
});
