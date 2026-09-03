import type { GlobalSchema } from "@shuri/core";

export const globals = [
  {
    slug: "site",
    title: "Configurações do site",
    category: { title: "Geral" },
    fields: [
      { type: "text", name: "name", required: true, maxLength: 120 },
      { type: "text", name: "tagline", maxLength: 200 },
    ],
  },
  {
    slug: "seoDefaults",
    title: "SEO padrão",
    category: { title: "SEO" },
    fields: [
      { type: "text", name: "title", required: true, maxLength: 60 },
      { type: "textarea", name: "description", maxLength: 160 },
    ],
  },
] as const satisfies readonly GlobalSchema[];
