import type { CollectionSchema, Field, GlobalSchema } from "@shuri/core";

/** Minimal JSON Schema subset this module emits — enough for OpenAPI 3.1's `components.schemas`. */
export interface JsonSchema {
  type?: string;
  format?: string;
  enum?: readonly string[];
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  title?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  readOnly?: boolean;
}

export function fieldSchema(field: Field): JsonSchema {
  const base: JsonSchema = field.label ? { title: field.label } : {};

  switch (field.type) {
    case "text":
    case "textarea":
      return {
        ...base,
        type: "string",
        minLength: field.minLength,
        maxLength: field.maxLength,
      };
    case "email":
      return { ...base, type: "string", format: "email" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "number": {
      const type = field.kind === "integer" ? "integer" : "number";
      const minimum = field.min ?? (field.sign === "positive" ? 0 : undefined);
      const maximum = field.max ?? (field.sign === "negative" ? 0 : undefined);
      return { ...base, type, minimum, maximum };
    }
    case "select": {
      const values = field.options.map((option) => option.value);
      return field.multiple
        ? { ...base, type: "array", items: { type: "string", enum: values } }
        : { ...base, type: "string", enum: values };
    }
    case "relation":
      return field.multiple
        ? { ...base, type: "array", items: { type: "string" } }
        : { ...base, type: "string" };
  }
}

export function collectionSchema(collection: CollectionSchema): JsonSchema {
  // `readOnly` is what tells OpenAPI the id belongs to responses only: the store generates it and
  // rejects a payload carrying one, so the same schema can back both the request body and the
  // response without promising a field that would earn a 400.
  const properties: Record<string, JsonSchema> = {
    id: { type: "string", readOnly: true },
  };
  const required: string[] = [];

  for (const field of collection.fields) {
    properties[field.name] = fieldSchema(field);
    if (field.required) required.push(field.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export function globalSchema(global: GlobalSchema): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of global.fields) {
    properties[field.name] = fieldSchema(field);
    if (field.required) required.push(field.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}
