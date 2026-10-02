import { describe, expect, it } from "vitest";
import { checkIntegrity, integrityIssues } from "./integrity.js";
import type { EntitySnapshot, FieldSpec, SchemaSnapshot } from "./snapshot.js";

describe("checkIntegrity", () => {
  it("lists violations in a deterministic order: collections, then globals, by slot", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      collections: {
        b: {
          fields: {
            r: { type: "relation", collection: "zz", multiple: false, index: false },
          },
        },
        a: {
          fields: {
            r: { type: "relation", collection: "yy", multiple: false, index: false },
          },
        },
      },
      globals: {
        g: {
          fields: {
            r: { type: "relation", collection: "xx", multiple: false, index: true },
          },
        },
      },
    };
    expect(checkIntegrity(snapshot).map((m) => m.split(" ")[0])).toEqual([
      "collection:a.r",
      "collection:b.r",
      "global:g.r",
      "global:g.r",
    ]);
  });

  it("does not trip on a field or collection named like an Object.prototype member", () => {
    const toStringRelation: FieldSpec = {
      type: "relation",
      collection: "toString",
      multiple: false,
      index: false,
    };
    const collections = Object.fromEntries<EntitySnapshot>([
      ["b", { fields: { r: toStringRelation } }],
      ["constructor", { fields: { x: { type: "text", index: false } } }],
    ]);
    const snapshot: SchemaSnapshot = { version: 1, collections, globals: {} };
    expect(checkIntegrity(snapshot)).toEqual([
      'collection:b.r references unknown collection "toString"',
    ]);
  });

  it("accepts a sound snapshot", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      collections: {
        authors: { fields: {} },
        posts: {
          fields: {
            author: {
              type: "relation",
              collection: "authors",
              multiple: false,
              index: true,
            },
          },
        },
      },
      globals: { site: { fields: { name: { type: "text", index: false } } } },
    };
    expect(integrityIssues(snapshot)).toEqual([]);
    expect(checkIntegrity(snapshot)).toEqual([]);
  });

  it("tells a dangling relation from an indexed global field by reason, slot and message", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      collections: {
        posts: {
          fields: {
            author: {
              type: "relation",
              collection: "authors",
              multiple: false,
              index: false,
            },
          },
        },
      },
      globals: {
        site: {
          fields: {
            tagline: { type: "text", index: true },
            owner: {
              type: "relation",
              collection: "people",
              multiple: false,
              index: false,
            },
          },
        },
      },
    };
    expect(integrityIssues(snapshot)).toEqual([
      {
        reason: "dangling-relation",
        slot: "collection:posts.author",
        message: 'collection:posts.author references unknown collection "authors"',
      },
      {
        reason: "dangling-relation",
        slot: "global:site.owner",
        message: 'global:site.owner references unknown collection "people"',
      },
      {
        reason: "global-index",
        slot: "global:site.tagline",
        message: "global:site.tagline is indexed, but a global has no index",
      },
    ]);
  });
});
