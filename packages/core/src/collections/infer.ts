import type { Field, RelationField, SelectField } from "./fields.js";
import type { CollectionSchema } from "./types.js";

/** Flattens an intersection/mapped-type chain into a plain object type, so editors show the resolved shape on hover. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

type FieldValue<F extends Field> = F extends { type: "text" | "textarea" | "email" }
  ? string
  : F extends SelectField
    ? F["options"][number]["value"]
    : F extends { type: "number" }
      ? number
      : F extends { type: "boolean" }
        ? boolean
        : F extends RelationField
          ? F["multiple"] extends true
            ? string[]
            : string
          : never;

type RequiredFields<Fields extends readonly Field[]> = {
  [F in Fields[number] as F["required"] extends true ? F["name"] : never]: FieldValue<F>;
};

type OptionalFields<Fields extends readonly Field[]> = {
  [F in Fields[number] as F["required"] extends true ? never : F["name"]]?: FieldValue<F>;
};

/** Maps a collection's `fields` to the plain object shape its records hold, one field type at a time. */
export type InferFields<Fields extends readonly Field[]> = Prettify<RequiredFields<Fields> & OptionalFields<Fields>>;

/** Maps a single `CollectionSchema` to the plain object shape of its records (excluding `id`). */
export type InferCollection<C extends CollectionSchema> = InferFields<C["fields"]>;

/** Maps an array of collections, as returned by `defineCollections`/`createCore`, to a `slug -> record shape` map. */
export type InferCollections<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: InferCollection<C>;
};
