import type { CollectionSchema, Field, GlobalSchema, ResolvedSchema } from "@shuri/core";
import type { EntitySnapshot, FieldSpec, SchemaSnapshot } from "../schema/snapshot.js";

function fieldOf(name: string, spec: FieldSpec): Field {
  const base = spec.index ? { name, index: true } : { name };
  switch (spec.type) {
    case "number":
      return { ...base, type: "number", kind: spec.kind };
    case "select":
      return {
        ...base,
        type: "select",
        options: [{ label: "option", value: "option" }],
        multiple: spec.multiple,
      };
    case "relation":
      return {
        ...base,
        type: "relation",
        collection: spec.collection,
        multiple: spec.multiple,
      };
    default:
      return { ...base, type: spec.type };
  }
}

const fieldsOf = (entity: EntitySnapshot): Field[] =>
  Object.entries(entity.fields).map(([name, spec]) => fieldOf(name, spec));

/**
 * Builds a schema with synthetic titles from a snapshot, so a driver can be exercised without an app.
 * Select fields get one synthetic option (the snapshot does not keep the real ones, and core wants at least one).
 * @param snapshot - The snapshot to materialise.
 * @returns A schema whose `snapshotOf` is `snapshot`.
 */
export function schemaFromSnapshot(snapshot: SchemaSnapshot): ResolvedSchema {
  const collections = Object.entries(snapshot.collections).map(
    ([slug, entity]): CollectionSchema => ({
      slug,
      title: slug,
      singular: slug,
      plural: slug,
      fields: fieldsOf(entity),
    }),
  );
  const globals = Object.entries(snapshot.globals).map(
    ([slug, entity]): GlobalSchema => ({
      slug,
      title: slug,
      category: { title: "Globals" },
      fields: fieldsOf(entity),
    }),
  );
  return { collections, globals };
}
