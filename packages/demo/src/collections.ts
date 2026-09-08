import type { CollectionSchema } from "@shuri/core";

export const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    // Public reads, declared explicitly: with auth on, an op with no rule needs a signed-in
    // principal. Writes have no rule, so any signed-in user (or a client with the scope) may.
    access: { list: () => true, view: () => true },
    // The Payload side of hooks: declared on the schema, run by the store whichever surface the
    // write came through. This one normalizes the title, and shows who wrote it when it came over
    // HTTP (`context.request`/`context.principal` are empty for a write made through the SDK).
    hooks: {
      beforeChange: [
        ({ operation, data, context }) => {
          const by = context.principal ? `${context.principal.kind}` : "sdk";
          console.log(`  [hooks] posts beforeChange (${operation}, by ${by})`);
          return typeof data.title === "string"
            ? { ...data, title: data.title.trim() }
            : undefined;
        },
      ],
    },
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
    access: { list: () => true, view: () => true },
    fields: [
      { type: "text", name: "name", required: true },
      { type: "email", name: "email", required: true },
    ],
  },
] as const satisfies readonly CollectionSchema[];
