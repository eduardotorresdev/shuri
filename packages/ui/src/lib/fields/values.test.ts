import type { Field, SelectField } from "@shuri/core";
import { describe, expect, it } from "vitest";
import {
  emptyValue,
  fieldLabel,
  formatCell,
  formValues,
  isMultiple,
  optionLabel,
  recordLabel,
  toRecordInput,
} from "./values.js";

const status: SelectField = {
  type: "select",
  name: "status",
  options: [
    { label: "Rascunho", value: "draft" },
    { label: "Publicado", value: "published" },
  ],
};

const fields: Field[] = [
  { type: "text", name: "title", required: true },
  { type: "textarea", name: "body" },
  { type: "number", name: "views", kind: "integer" },
  { type: "boolean", name: "published" },
  status,
  { type: "relation", name: "tags", collection: "tags", multiple: true },
];

describe("isMultiple", () => {
  it("is true only for a select or relation declared multiple", () => {
    expect(
      isMultiple({ type: "relation", name: "tags", collection: "tags", multiple: true }),
    ).toBe(true);
    expect(isMultiple(status)).toBe(false);
    expect(isMultiple({ type: "text", name: "title" })).toBe(false);
  });
});

describe("emptyValue", () => {
  it("gives every control a defined starting value, so none starts uncontrolled", () => {
    for (const field of fields) {
      expect(emptyValue(field)).toBeDefined();
    }
  });

  it("starts a list field as a list and a boolean as false", () => {
    expect(emptyValue(fields[5] as Field)).toEqual([]);
    expect(emptyValue(fields[3] as Field)).toBe(false);
  });

  it("starts a number as a string, since that is what the input holds while being typed", () => {
    expect(emptyValue(fields[2] as Field)).toBe("");
  });
});

describe("formValues", () => {
  it("seeds from the stored record and fills the rest in empty", () => {
    expect(formValues(fields, { title: "Oi", published: true })).toEqual({
      title: "Oi",
      body: "",
      views: "",
      published: true,
      status: "",
      tags: [],
    });
  });

  it("treats a stored null as absent, so the control still starts defined", () => {
    expect(formValues([{ type: "text", name: "title" }], { title: null })).toEqual({
      title: "",
    });
  });
});

describe("toRecordInput", () => {
  it("drops the fields left empty, so an optional field stays absent", () => {
    const input = toRecordInput(fields, formValues(fields, { title: "Oi" }));

    expect(input).toEqual({ title: "Oi", published: false });
  });

  it("keeps false, which is a value the author chose rather than an absence", () => {
    const input = toRecordInput([{ type: "boolean", name: "published" }], {
      published: false,
    });

    expect(input).toEqual({ published: false });
  });

  it("converts a number back from the string the input held", () => {
    const input = toRecordInput([{ type: "number", name: "views", kind: "integer" }], {
      views: "42",
    });

    expect(input).toEqual({ views: 42 });
  });

  it("keeps zero, which an empty check would otherwise throw away", () => {
    const input = toRecordInput([{ type: "number", name: "views", kind: "integer" }], {
      views: "0",
    });

    expect(input).toEqual({ views: 0 });
  });

  it("sends a list only when something is selected", () => {
    const tags: Field = {
      type: "relation",
      name: "tags",
      collection: "tags",
      multiple: true,
    };

    expect(toRecordInput([tags], { tags: [] })).toEqual({});
    expect(toRecordInput([tags], { tags: ["a"] })).toEqual({ tags: ["a"] });
  });

  it("ignores anything not declared as a field", () => {
    const input = toRecordInput([{ type: "text", name: "title" }], {
      title: "Oi",
      id: "should-not-be-sent",
    });

    expect(input).toEqual({ title: "Oi" });
  });
});

describe("fieldLabel", () => {
  it("prefers the declared label and falls back to the field's name", () => {
    expect(fieldLabel({ type: "text", name: "title", label: "Título" })).toBe("Título");
    expect(fieldLabel({ type: "text", name: "title" })).toBe("title");
  });
});

describe("optionLabel", () => {
  it("labels a value through the declared options", () => {
    expect(optionLabel(status, "draft")).toBe("Rascunho");
  });

  it("shows a value whose option was removed, rather than blanking the cell", () => {
    expect(optionLabel(status, "archived")).toBe("archived");
  });
});

describe("formatCell", () => {
  it("marks an absent value rather than leaving the cell blank", () => {
    expect(formatCell({ type: "text", name: "title" }, undefined)).toBe("—");
    expect(formatCell({ type: "text", name: "title" }, "")).toBe("—");
  });

  it("reads a boolean as words", () => {
    expect(formatCell({ type: "boolean", name: "published" }, true)).toBe("Sim");
    expect(formatCell({ type: "boolean", name: "published" }, false)).toBe("Não");
  });

  it("labels select values, one or many", () => {
    expect(formatCell(status, "published")).toBe("Publicado");
    expect(formatCell({ ...status, multiple: true }, ["draft", "published"])).toBe(
      "Rascunho, Publicado",
    );
  });
});

describe("recordLabel", () => {
  const collection = {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [],
    labelField: "title",
  };

  it("uses the collection's labelling field", () => {
    expect(recordLabel(collection, { id: "1", title: "Olá" })).toBe("Olá");
  });

  it("falls back to the id when that field is empty or absent", () => {
    expect(recordLabel(collection, { id: "1", title: "" })).toBe("1");
    expect(recordLabel({ ...collection, labelField: undefined }, { id: "1" })).toBe("1");
  });
});

describe("formatCell with relations", () => {
  const author: Field = { type: "relation", name: "author", collection: "authors" };
  const labels = { authors: { a1: "Ada Lovelace" } };

  it("reads a relation as the referenced record's label", () => {
    expect(formatCell(author, "a1", labels)).toBe("Ada Lovelace");
  });

  it("shows a dangling id rather than a blank when the record is gone", () => {
    expect(formatCell(author, "a9", labels)).toBe("a9");
  });

  it("joins a multi-relation", () => {
    const tags: Field = {
      type: "relation",
      name: "tags",
      collection: "authors",
      multiple: true,
    };

    expect(formatCell(tags, ["a1", "a9"], labels)).toBe("Ada Lovelace, a9");
  });
});
