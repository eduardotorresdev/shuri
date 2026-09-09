import { describe, expect, it } from "vitest";
import type { Field } from "@shuri/core";
import type { AdminCollection } from "$shared/schema.js";
import {
  describeFilter,
  filterFields,
  filterOps,
  filterParams,
  formFilters,
  isValidFilter,
  readFilters,
  toWhere,
} from "./filters.js";

const title: Field = { type: "text", name: "title", label: "Título" };
const body: Field = { type: "textarea", name: "body" };
const views: Field = { type: "number", name: "views", label: "Views", kind: "integer" };
const published: Field = { type: "boolean", name: "published", label: "Publicado" };
const status: Field = {
  type: "select",
  name: "status",
  label: "Situação",
  options: [
    { label: "Rascunho", value: "draft" },
    { label: "Publicado", value: "published" },
  ],
};
const author: Field = {
  type: "relation",
  name: "author",
  label: "Autor",
  collection: "authors",
};
const tags: Field = {
  type: "select",
  name: "tags",
  options: [{ label: "Svelte", value: "svelte" }],
  multiple: true,
};

const posts: AdminCollection = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  labelField: "title",
  fields: [title, body, views, published, status, author, tags],
};

const fields = [title, body, views, published, status, author, tags];

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.append(name, value);
  return data;
}

describe("filterOps", () => {
  it("offers only a substring match on prose, and the full range on a number", () => {
    expect(filterOps(title)).toEqual(["contains"]);
    expect(filterOps(body)).toEqual(["contains"]);
    expect(filterOps(views)).toEqual(["eq", "ne", "gt", "gte", "lt", "lte"]);
  });

  it("offers an exact match on a closed set of values", () => {
    expect(filterOps(published)).toEqual(["eq"]);
    expect(filterOps(status)).toEqual(["eq"]);
    expect(filterOps(author)).toEqual(["eq"]);
  });

  it("refuses a multi-valued field, whose stored list no operator compares against", () => {
    expect(filterOps(tags)).toEqual([]);
  });
});

describe("filterFields", () => {
  it("keeps every filterable field in declaration order, textareas included", () => {
    expect(filterFields(posts).map((field) => field.name)).toEqual([
      "title",
      "body",
      "views",
      "published",
      "status",
      "author",
    ]);
  });
});

describe("isValidFilter", () => {
  it("refuses an operator the field doesn't offer", () => {
    expect(isValidFilter(title, { op: "gt", text: "a" })).toBe(false);
    expect(isValidFilter(title, { op: "contains", text: "a" })).toBe(true);
  });

  it("refuses a number filter whose text isn't one", () => {
    expect(isValidFilter(views, { op: "gte", text: "abc" })).toBe(false);
    expect(isValidFilter(views, { op: "gte", text: "" })).toBe(false);
    expect(isValidFilter(views, { op: "gte", text: "10" })).toBe(true);
  });

  it("refuses a value outside a select's declared options", () => {
    expect(isValidFilter(status, { op: "eq", text: "archived" })).toBe(false);
    expect(isValidFilter(status, { op: "eq", text: "draft" })).toBe(true);
  });

  it("refuses anything but the two words a boolean has", () => {
    expect(isValidFilter(published, { op: "eq", text: "sim" })).toBe(false);
    expect(isValidFilter(published, { op: "eq", text: "false" })).toBe(true);
  });

  it("refuses an empty value, which is how a control says 'no filter'", () => {
    expect(isValidFilter(title, { op: "contains", text: "" })).toBe(false);
  });
});

describe("readFilters", () => {
  it("reads one param per field, operator and all", () => {
    expect(readFilters(fields, params("f.title=contains:svelte&f.views=gte:10"))).toEqual(
      {
        title: { op: "contains", text: "svelte" },
        views: { op: "gte", text: "10" },
      },
    );
  });

  it("keeps colons inside the value, splitting only at the operator's", () => {
    expect(readFilters(fields, params("f.title=contains:a:b"))).toEqual({
      title: { op: "contains", text: "a:b" },
    });
  });

  it("drops a param a hand-edited URL got wrong, rather than querying with it", () => {
    expect(
      readFilters(
        fields,
        params("f.title=svelte&f.views=gte:abc&f.status=eq:archived&f.tags=eq:svelte"),
      ),
    ).toEqual({});
  });

  it("ignores the list's own params", () => {
    expect(readFilters(fields, params("sort=title&direction=desc&offset=25"))).toEqual(
      {},
    );
  });
});

describe("formFilters", () => {
  it("pairs each value control with its operator select", () => {
    expect(formFilters(fields, form({ "f.views": "10", "op.views": "lt" }))).toEqual({
      views: { op: "lt", text: "10" },
    });
  });

  it("falls back to the field's default operator when the form has no select for it", () => {
    expect(formFilters(fields, form({ "f.title": "svelte" }))).toEqual({
      title: { op: "contains", text: "svelte" },
    });
  });

  it("trims what was typed, so a stray space isn't searched for", () => {
    expect(formFilters(fields, form({ "f.title": "  svelte  " }))).toEqual({
      title: { op: "contains", text: "svelte" },
    });
  });

  it("leaves out the boxes left empty and the selects left on 'todos'", () => {
    expect(
      formFilters(fields, form({ "f.title": "   ", "f.status": "", "f.views": "" })),
    ).toEqual({});
  });
});

describe("filterParams", () => {
  it("encodes the filters that apply and clears the fields that don't", () => {
    expect(filterParams(fields, { title: { op: "contains", text: "svelte" } })).toEqual({
      "f.title": "contains:svelte",
      "f.body": undefined,
      "f.views": undefined,
      "f.published": undefined,
      "f.status": undefined,
      "f.author": undefined,
      "f.tags": undefined,
    });
  });
});

describe("toWhere", () => {
  it("gives each filter the type the field is stored as", () => {
    expect(
      toWhere(fields, {
        title: { op: "contains", text: "svelte" },
        views: { op: "gte", text: "10" },
        published: { op: "eq", text: "true" },
        author: { op: "eq", text: "author-1" },
      }),
    ).toEqual({
      title: { op: "contains", value: "svelte" },
      views: { op: "gte", value: 10 },
      published: { op: "eq", value: true },
      author: { op: "eq", value: "author-1" },
    });
  });

  it("leaves the query bare when nothing is filtered", () => {
    expect(toWhere(fields, {})).toBeUndefined();
    expect(toWhere(fields, { views: { op: "gte", text: "abc" } })).toBeUndefined();
  });
});

describe("describeFilter", () => {
  it("reads a value the way the table's cells do", () => {
    expect(describeFilter(published, { op: "eq", text: "true" })).toBe("Publicado: Sim");
    expect(describeFilter(status, { op: "eq", text: "draft" })).toBe(
      "Situação: Rascunho",
    );
    expect(
      describeFilter(
        author,
        { op: "eq", text: "author-1" },
        { authors: { "author-1": "Ada" } },
      ),
    ).toBe("Autor: Ada");
  });

  it("spells out any operator other than equality", () => {
    expect(describeFilter(title, { op: "contains", text: "svelte" })).toBe(
      "Título: contém svelte",
    );
    expect(describeFilter(views, { op: "gte", text: "10" })).toBe("Views: ≥ 10");
  });

  it("names a field with no label by its name", () => {
    expect(describeFilter(body, { op: "contains", text: "svelte" })).toBe(
      "body: contém svelte",
    );
  });
});
