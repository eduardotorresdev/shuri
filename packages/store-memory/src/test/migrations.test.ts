// Integration: the memory adapter's migration driver against the shared driver contract, and
// migrations applied to a store that is being queried through the real adapter.
import type { CollectionSchema } from "@shuri/core";
import {
  migrateUp,
  replay,
  assertMigrated,
  migrationStatus,
  PendingMigrationsError,
  snapshotOf,
  type MigrationFile,
  type MigrationOp,
} from "@shuri/migrate";
import {
  describeMigrationDriverContract,
  schemaFromSnapshot,
  chainOf,
} from "@shuri/migrate/testing";
import { describe, expect, it } from "vitest";
import { createMemoryAdapter } from "../memory-adapter.js";

describeMigrationDriverContract("memory", {
  async make() {
    let failAfter: number | undefined;
    const adapter = createMemoryAdapter({
      onStep(done) {
        if (failAfter !== undefined && done >= failAfter) {
          failAfter = undefined;
          throw new Error(`injected failure after step ${done}`);
        }
      },
    });
    return {
      adapter,
      injectFailure(afterStep) {
        failAfter = afterStep;
      },
      async cleanup() {},
    };
  },
});

const items = { kind: "collection", slug: "items" } as const;
const text = { type: "text", index: false } as const;
const indexedText = { type: "text", index: true } as const;

/**
 * @param files - A chain of migrations.
 * @returns The schema the chain leaves behind, as the app would declare it.
 */
function schemaAfter(files: readonly MigrationFile[]) {
  return schemaFromSnapshot(replay(files).snapshot);
}
const collectionOf = (files: readonly MigrationFile[], slug: string): CollectionSchema =>
  schemaAfter(files).collections.find((c) => c.slug === slug) as CollectionSchema;

describe("memory adapter: migrations end to end", () => {
  it("brings an empty store up to the schema, after which assertMigrated passes", async () => {
    const files = chainOf([
      { op: "createEntity", target: items, fields: { title: text } },
    ]);
    const adapter = createMemoryAdapter();
    const schema = schemaAfter(files);

    await expect(
      assertMigrated({ files, driver: adapter.migrations, schema }),
    ).rejects.toBeInstanceOf(PendingMigrationsError);
    await migrateUp({ files, driver: adapter.migrations, schema });
    await assertMigrated({ files, driver: adapter.migrations, schema });

    const status = await migrationStatus({ files, driver: adapter.migrations, schema });
    expect(status.pending).toEqual([]);
    expect(status.schemaDrift).toBeNull();
  });

  it("a schema that gains an index at runtime is served by the new index, rows included", async () => {
    const first = chainOf([
      { op: "createEntity", target: items, fields: { title: text } },
    ]);
    const adapter = createMemoryAdapter();
    await migrateUp({ files: first, driver: adapter.migrations });
    const before = collectionOf(first, "items");
    await adapter.insert(before, { title: "a" });
    await adapter.insert(before, { title: "b" });
    await adapter.insert(before, { title: "a" });

    // The app reloads with a new schema object that declares the index (HMR).
    const ops: MigrationOp[] = [
      { op: "setIndex", target: items, name: "title", index: true },
    ];
    const files = chainOf(first[0].ops, ops);
    await migrateUp({ files, driver: adapter.migrations });
    const after = collectionOf(files, "items");

    const found = await adapter.findMany(after, {
      where: { title: { op: "eq", value: "a" } },
    });
    expect(found).toHaveLength(2);
    expect(
      await adapter.count(after, { where: { title: { op: "eq", value: "b" } } }),
    ).toBe(1);

    // Rows written after the reload land in the rebuilt index.
    await adapter.insert(after, { title: "b" });
    expect(
      await adapter.count(after, { where: { title: { op: "eq", value: "b" } } }),
    ).toBe(2);
  });

  it("a field renamed by a migration is queryable under its new name, with its index", async () => {
    const first = chainOf([
      { op: "createEntity", target: items, fields: { title: indexedText } },
    ]);
    const adapter = createMemoryAdapter();
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.insert(collectionOf(first, "items"), { title: "a" });

    const files = chainOf(first[0].ops, [
      { op: "renameField", target: items, from: "title", to: "name" },
    ]);
    await migrateUp({ files, driver: adapter.migrations });
    const renamed = collectionOf(files, "items");

    expect(renamed.fields.find((f) => f.name === "name")?.index).toBe(true);
    const found = await adapter.findMany(renamed, {
      where: { name: { op: "eq", value: "a" } },
    });
    expect(found.map((r) => r.name)).toEqual(["a"]);
    expect(found[0]).not.toHaveProperty("title");
  });

  it("the snapshot of the schema it was migrated to has no drift", async () => {
    const files = chainOf([
      { op: "createEntity", target: items, fields: { title: text } },
    ]);
    const adapter = createMemoryAdapter();
    const schema = schemaAfter(files);
    await migrateUp({ files, driver: adapter.migrations, schema });
    expect(snapshotOf(schema)).toEqual(replay(files).snapshot);
  });
});
