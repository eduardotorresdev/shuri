import { describe, expect, it } from "vitest";
import type { CollectionSchema } from "../collections/types.js";
import type { GlobalSchema } from "../globals/types.js";
import { derivedScopes, expandScopes, SCOPE_PATTERN, scopeFor } from "./scopes.js";

const posts: CollectionSchema = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  fields: [{ type: "text", name: "title" }],
};
const sessions: CollectionSchema = { ...posts, slug: "_sessions", internal: true };
const site: GlobalSchema = {
  slug: "site",
  title: "Site",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name" }],
};

describe("scopeFor", () => {
  it("joins slug and op with a colon", () => {
    expect(scopeFor("posts", "list")).toBe("posts:list");
  });
});

describe("derivedScopes", () => {
  it("emits every op of every served collection and of every global", () => {
    expect(derivedScopes([posts, sessions], [site])).toEqual([
      "posts:create",
      "posts:list",
      "posts:view",
      "posts:update",
      "posts:delete",
      "site:read",
      "site:update",
    ]);
  });
});

describe("expandScopes", () => {
  const universe = derivedScopes([posts, sessions], [site]);

  it("expands * to the whole universe", () => {
    expect([...expandScopes(["*"], universe)]).toEqual(universe);
  });

  it("expands slug:* and *:op", () => {
    expect([...expandScopes(["site:*"], universe)]).toEqual(["site:read", "site:update"]);
    expect([...expandScopes(["*:update"], universe)]).toEqual([
      "posts:update",
      "site:update",
    ]);
  });

  it("keeps a literal only when the universe defines it", () => {
    expect([...expandScopes(["posts:list", "_sessions:list", "nope"], universe)]).toEqual(
      ["posts:list"],
    );
  });

  it("dedupes overlapping patterns", () => {
    expect([...expandScopes(["posts:*", "posts:list"], universe)]).toHaveLength(5);
  });
});

describe("SCOPE_PATTERN", () => {
  it("accepts the four shapes and nothing looser", () => {
    for (const ok of ["*", "posts:*", "*:list", "posts:list", "seoDefaults:read"]) {
      expect(ok).toMatch(SCOPE_PATTERN);
    }
    for (const bad of ["", "posts", "posts:", ":list", "posts:List", "a b:list", "**"]) {
      expect(bad).not.toMatch(SCOPE_PATTERN);
    }
  });
});
