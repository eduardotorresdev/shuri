import { describe, expect, it } from "vitest";
import { isFieldName, isSlug } from "./names.js";

describe("name grammar", () => {
  it.each(["posts", "seoDefaults", "blog-posts", "blog_posts", "a", "x9"])(
    "accepts the slug %s",
    (slug) => expect(isSlug(slug)).toBe(true),
  );

  it.each(["", "_sessions", "Posts", "9lives", "a.b", "a b", "-a", "a".repeat(64)])(
    "rejects the slug %j",
    (slug) => expect(isSlug(slug)).toBe(false),
  );

  it("accepts a 63-character slug and rejects 64", () => {
    expect(isSlug("a".repeat(63))).toBe(true);
    expect(isSlug("a".repeat(64))).toBe(false);
  });

  it.each(["title", "emailVerified", "userId", "created_at", "A1"])(
    "accepts the field name %s",
    (name) => expect(isFieldName(name)).toBe(true),
  );

  it.each(["", "id", "_x", "1a", "a-b", "a.b", "a b"])(
    "rejects the field name %j",
    (name) => expect(isFieldName(name)).toBe(false),
  );

  it("treats id as reserved but not names that merely contain it", () => {
    expect(isFieldName("id")).toBe(false);
    expect(isFieldName("userId")).toBe(true);
    expect(isFieldName("identity")).toBe(true);
  });
});
