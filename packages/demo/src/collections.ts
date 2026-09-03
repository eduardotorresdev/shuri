import type { CollectionSchema } from "@shuri/core";

export const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [
      { type: "text", name: "title", required: true, maxLength: 120 },
      { type: "textarea", name: "body" },
      { type: "boolean", name: "published" },
    ],
  },
  {
    slug: "authors",
    title: "Authors",
    singular: "Author",
    plural: "Authors",
    fields: [
      { type: "text", name: "name", required: true },
      { type: "email", name: "email", required: true },
    ],
  },
] as const satisfies readonly CollectionSchema[];
