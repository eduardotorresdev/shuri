import type { CollectionSchema, GlobalSchema } from "@shuri/core";

/**
 * The schema the SUT serves. `posts` covers one field of every scalar type `validateRecord`
 * knows (text/textarea/boolean/number/select/email), so an insert exercises the real validation
 * cost rather than a one-field toy. `published` and `title` are indexed, as a consumer filtering
 * and sorting on them would declare; the memory adapter uses the index for `eq` only. Reads are public (`list`/`view`), as in the demo, so the
 * "open" and "auth" profiles serve the same routes and only the principal resolution differs.
 */
export const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    access: { list: () => true, view: () => true },
    fields: [
      { type: "text", name: "title", required: true, maxLength: 120, index: true },
      { type: "textarea", name: "body", maxLength: 2000 },
      { type: "boolean", name: "published", index: true },
      { type: "number", name: "views", kind: "integer", sign: "positive" },
      {
        type: "select",
        name: "category",
        options: [
          { label: "News", value: "news" },
          { label: "Guide", value: "guide" },
          { label: "Opinion", value: "opinion" },
        ],
      },
      { type: "email", name: "contact" },
    ],
  },
  {
    slug: "authors",
    title: "Authors",
    singular: "Author",
    plural: "Authors",
    access: { list: () => true, view: () => true },
    fields: [
      { type: "text", name: "name", required: true },
      { type: "email", name: "email", required: true },
    ],
  },
] as const satisfies readonly CollectionSchema[];

export const globals = [
  {
    slug: "site",
    title: "Site settings",
    category: { title: "General" },
    access: { read: () => true },
    fields: [
      { type: "text", name: "name", required: true, maxLength: 120 },
      { type: "text", name: "tagline", maxLength: 200 },
    ],
  },
] as const satisfies readonly GlobalSchema[];

/** One `posts` record as the seed writes it, and as the insert scenarios post it. */
export interface PostInput {
  title: string;
  body?: string;
  published?: boolean;
  views?: number;
  category?: "news" | "guide" | "opinion";
  contact?: string;
}

const CATEGORIES = ["news", "guide", "opinion"] as const;

/**
 * A deterministic post for index `i`: every field set, so validation walks all six, and
 * `published` alternating so a `published eq true` filter keeps half the table.
 * @param i - The post's index in the seed.
 * @returns The record to insert.
 */
export function samplePost(i: number): PostInput {
  return {
    title: `Post #${i}`,
    body: `Body of post ${i}. `.repeat(4),
    published: i % 2 === 0,
    views: i * 7,
    category: CATEGORIES[i % CATEGORIES.length] as PostInput["category"],
    contact: `author${i % 50}@example.com`,
  };
}
