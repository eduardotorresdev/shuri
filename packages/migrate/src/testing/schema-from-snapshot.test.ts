import { createCore } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { snapshotOf, type SchemaSnapshot } from "../schema/snapshot.js";
import { schemaFromSnapshot } from "./schema-from-snapshot.js";

const everything: SchemaSnapshot = {
  version: 1,
  collections: {
    tags: { fields: { name: { type: "text", index: true } } },
    posts: {
      fields: {
        title: { type: "text", index: false },
        body: { type: "textarea", index: false },
        contact: { type: "email", index: true },
        live: { type: "boolean", index: false },
        views: { type: "number", kind: "integer", index: false },
        price: { type: "number", kind: "float", index: true },
        status: { type: "select", multiple: false, index: false },
        labels: { type: "select", multiple: true, index: false },
        tag: { type: "relation", collection: "tags", multiple: false, index: false },
        tags: { type: "relation", collection: "tags", multiple: true, index: true },
      },
    },
  },
  globals: { site: { fields: { name: { type: "text", index: false } } } },
};

describe("schemaFromSnapshot", () => {
  it("builds a schema whose snapshot is the one it came from, for every field type", () => {
    expect(snapshotOf(schemaFromSnapshot(everything))).toEqual(everything);
  });

  it("builds a schema @shuri/core accepts", () => {
    const { collections, globals } = schemaFromSnapshot(everything);
    expect(() => createCore({ collections, globals })).not.toThrow();
  });

  it("is empty for an empty snapshot", () => {
    expect(schemaFromSnapshot({ version: 1, collections: {}, globals: {} })).toEqual({
      collections: [],
      globals: [],
    });
  });
});
