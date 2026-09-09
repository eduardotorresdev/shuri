import { describe, expect, it } from "vitest";
import type { AdminSchema } from "$shared/schema.js";
import { isActive, navGroups } from "./nav.js";

const schema: AdminSchema = {
  title: "Admin",
  basePath: "/admin",
  api: { collections: "/collections", globals: "/globals", events: "/events" },
  collections: [
    { slug: "posts", title: "Posts", singular: "Post", plural: "Posts", fields: [] },
  ],
  globals: [
    { slug: "site", title: "Site", category: "Geral", fields: [] },
    { slug: "seo", title: "SEO", category: "SEO", fields: [] },
    { slug: "contact", title: "Contato", category: "Geral", fields: [] },
  ],
};

describe("navGroups", () => {
  it("lists the collections first, by plural name", () => {
    expect(navGroups(schema)[0]).toEqual({
      title: "Coleções",
      items: [
        {
          label: "Posts",
          href: "/admin/collections/posts",
          icon: "collection",
          newHref: "/admin/collections/posts/new",
        },
      ],
    });
  });

  it("groups globals by category, in the order the categories were first declared", () => {
    expect(navGroups(schema).slice(1)).toEqual([
      {
        title: "Geral",
        items: [
          { label: "Site", href: "/admin/globals/site", icon: "global" },
          { label: "Contato", href: "/admin/globals/contact", icon: "global" },
        ],
      },
      {
        title: "SEO",
        items: [{ label: "SEO", href: "/admin/globals/seo", icon: "global" }],
      },
    ]);
  });

  it("leaves an empty group out rather than rendering a heading with nothing under it", () => {
    expect(navGroups({ ...schema, collections: [], globals: [] })).toEqual([]);
  });

  it("follows a relocated admin", () => {
    const moved = navGroups({ ...schema, basePath: "/cms" });

    expect(moved[0]?.items[0]?.href).toBe("/cms/collections/posts");
  });
});

describe("isActive", () => {
  it("keeps a collection highlighted while one of its records is open", () => {
    expect(isActive("/admin/collections/posts", "/admin/collections/posts/abc")).toBe(
      true,
    );
  });

  it("does not highlight a sibling whose path merely starts the same way", () => {
    expect(isActive("/admin/collections/post", "/admin/collections/posts")).toBe(false);
  });
});
