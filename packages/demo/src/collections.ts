import type { CollectionSchema } from "@shuri/core";

export const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [
      { type: "text", name: "title", label: "Título", required: true, maxLength: 120 },
      { type: "textarea", name: "body", label: "Conteúdo" },
      {
        type: "select",
        name: "status",
        label: "Situação",
        options: [
          { label: "Rascunho", value: "draft" },
          { label: "Publicado", value: "published" },
        ],
      },
      { type: "relation", name: "author", label: "Autor", collection: "authors" },
      {
        type: "number",
        name: "readingMinutes",
        label: "Minutos de leitura",
        kind: "integer",
        sign: "positive",
        max: 90,
      },
      { type: "boolean", name: "published", label: "Publicado" },
    ],
  },
  {
    slug: "authors",
    title: "Authors",
    singular: "Author",
    plural: "Authors",
    fields: [
      { type: "text", name: "name", label: "Nome", required: true },
      { type: "email", name: "email", label: "E-mail", required: true },
    ],
  },
] as const satisfies readonly CollectionSchema[];
