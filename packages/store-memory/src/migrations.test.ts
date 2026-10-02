import { chainOf } from "@shuri/migrate/testing";
import {
  LockLostError,
  RenameCollisionError,
  migrateUp,
  type MigrationOp,
} from "@shuri/migrate";
import { describe, expect, it } from "vitest";
import { createMemoryAdapter } from "./memory-adapter.js";

const items = { kind: "collection", slug: "items" } as const;
const text = { type: "text", index: false } as const;
const create: MigrationOp = {
  op: "createEntity",
  target: items,
  fields: { title: text, note: text },
};
const schemaOf = (slug: string) => ({
  slug,
  title: slug,
  singular: slug,
  plural: slug,
  fields: [],
});
const g = (slug: string) => ({
  slug,
  title: slug,
  category: { title: "G" },
  fields: [],
});
const items0 = schemaOf("items");

describe("memory migration driver", () => {
  it("declares itself atomic per migration with a transactional journal", () => {
    expect(createMemoryAdapter().migrations.capabilities).toEqual({
      atomicity: "migration",
      transactionalJournal: true,
      render: false,
    });
  });

  it("plans only the ops that have an effect, estimating the rows each touches", async () => {
    const adapter = createMemoryAdapter();
    const first = chainOf([create]);
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.insert(items0, { title: "a" });
    await adapter.insert(items0, { title: "b" });

    const files = chainOf(first[0].ops, [
      { op: "addField", target: items, name: "title", spec: text }, // already there: noop
      { op: "dropField", target: items, name: "note" },
      { op: "setIndex", target: items, name: "title", index: true },
    ]);
    const { plans } = await migrateUp({
      files,
      driver: adapter.migrations,
      allowDestructive: "all",
      dryRun: true,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].steps.map((s) => [s.destructive, s.estimatedRows])).toEqual([
      [true, 2],
      [false, undefined],
    ]);
    expect(plans[0].steps[0].description).toContain("dropField");
  });

  it("a dry run changes neither the data nor the journal", async () => {
    const adapter = createMemoryAdapter();
    const first = chainOf([create]);
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.insert(items0, { title: "a", note: "n" });
    const files = chainOf(first[0].ops, [
      { op: "dropField", target: items, name: "note" },
    ]);
    await migrateUp({
      files,
      driver: adapter.migrations,
      allowDestructive: "all",
      dryRun: true,
    });
    expect((await adapter.migrations.applied()).map((e) => e.id)).toEqual([first[0].id]);
    expect(await adapter.findMany(items0)).toMatchObject([{ title: "a", note: "n" }]);
  });

  it("refuses to rename a collection onto leftover data under the new name and leaves everything as it was", async () => {
    const adapter = createMemoryAdapter();
    const first = chainOf([create]);
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.insert(items0, { title: "a" });
    // Rows the schema does not know about (orphaned by an out-of-band change) sit under the new name.
    await adapter.insert(schemaOf("things"), { x: 1 });

    const files = chainOf(first[0].ops, [
      { op: "dropField", target: items, name: "note" },
      { op: "renameEntity", target: items, to: "things" },
    ]);
    await expect(
      migrateUp({ files, driver: adapter.migrations, allowDestructive: "all" }),
    ).rejects.toBeInstanceOf(RenameCollisionError);
    // The dropField that ran before the failure was rolled back with it.
    expect(await adapter.findMany(items0)).toMatchObject([{ title: "a" }]);
    expect((await adapter.migrations.applied()).map((e) => e.id)).toEqual([first[0].id]);
  });

  it("fences before the swap: a lock lost mid-migration changes nothing", async () => {
    const adapter = createMemoryAdapter();
    const first = chainOf([create]);
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.insert(items0, { title: "a", note: "n" });
    const files = chainOf(first[0].ops, [
      { op: "dropField", target: items, name: "note" },
    ]);
    const lock = await adapter.migrations.acquireLock("a", 1000);
    if (!lock) throw new Error("no lock");
    const plan = await adapter.migrations.plan({
      id: files[1].id,
      checksum: "sha256:x",
      ops: [{ op: files[1].ops[0], effect: "applied", dependents: [] }],
      before: {
        snapshot: { version: 1, collections: {}, globals: {} },
        lineage: { entities: {}, fields: {} },
        tombstones: {},
      },
      after: {
        snapshot: { version: 1, collections: {}, globals: {} },
        lineage: { entities: {}, fields: {} },
        tombstones: {},
      },
    });
    await adapter.migrations.forceUnlock();
    await expect(adapter.migrations.execute(plan, lock)).rejects.toBeInstanceOf(
      LockLostError,
    );
    expect(await adapter.findMany(items0)).toMatchObject([{ title: "a", note: "n" }]);
    expect((await adapter.migrations.applied()).map((e) => e.id)).toEqual([first[0].id]);
  });

  it("refuses to rename a global onto an existing one with a RenameCollisionError and changes nothing", async () => {
    const adapter = createMemoryAdapter();
    const site = { kind: "global", slug: "site" } as const;
    const first = chainOf([{ op: "createEntity", target: site, fields: { name: text } }]);
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.updateGlobal(g("site"), { name: "site" });
    // A document the schema does not know about (orphaned by an out-of-band change) sits under the new name.
    await adapter.updateGlobal(g("settings"), { name: "settings" });
    const files = chainOf(first[0].ops, [
      { op: "renameEntity", target: site, to: "settings" },
    ]);
    const failure = await migrateUp({ files, driver: adapter.migrations }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RenameCollisionError);
    expect(failure).toMatchObject({ target: site, to: "settings" });
    expect(await adapter.findGlobal(g("site"))).toEqual({ name: "site" });
    expect(await adapter.findGlobal(g("settings"))).toEqual({ name: "settings" });
  });

  it("clones only the tables a migration writes to: the others keep their indexes and rows", async () => {
    const adapter = createMemoryAdapter();
    const other = { kind: "collection", slug: "other" } as const;
    const first = chainOf([
      create,
      { op: "createEntity", target: other, fields: { title: text } },
    ]);
    await migrateUp({ files: first, driver: adapter.migrations });
    const otherRow = await adapter.insert(schemaOf("other"), { title: "x" });
    await adapter.insert(items0, { title: "a", note: "n" });
    const files = chainOf(first[0].ops, [
      { op: "dropField", target: items, name: "note" },
    ]);
    await migrateUp({ files, driver: adapter.migrations, allowDestructive: "all" });
    // Same row object: the untouched table was shared with the live state, not copied.
    expect(await adapter.findOne(schemaOf("other"), otherRow.id)).toBe(otherRow);
    expect(await adapter.findMany(items0)).toMatchObject([{ title: "a" }]);
  });

  it("swaps the data in only after the journal accepted the migration", async () => {
    const adapter = createMemoryAdapter();
    const first = chainOf([create]);
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.insert(items0, { title: "a", note: "n" });
    const files = chainOf(first[0].ops, [
      { op: "dropField", target: items, name: "note" },
    ]);
    const lock = await adapter.migrations.acquireLock("a", 1000);
    if (!lock) throw new Error("no lock");
    const plan = await adapter.migrations.plan({
      id: files[1].id,
      checksum: "sha256:x",
      ops: [{ op: files[1].ops[0], effect: "applied", dependents: [] }],
      before: {
        snapshot: { version: 1, collections: {}, globals: {} },
        lineage: { entities: {}, fields: {} },
        tombstones: {},
      },
      after: {
        snapshot: { version: 1, collections: {}, globals: {} },
        lineage: { entities: {}, fields: {} },
        tombstones: {},
      },
    });
    const failing = new Error("journal down");
    adapter.migrations.journal.markApplied = async () => {
      throw failing;
    };
    await expect(adapter.migrations.execute(plan, lock)).rejects.toBe(failing);
    expect(await adapter.findMany(items0)).toMatchObject([{ title: "a", note: "n" }]);
  });

  it("moves a global's document with a renameEntity and drops its fields with dropField", async () => {
    const adapter = createMemoryAdapter();
    const site = { kind: "global", slug: "site" } as const;
    const first = chainOf([
      { op: "createEntity", target: site, fields: { name: text, tagline: text } },
    ]);
    await migrateUp({ files: first, driver: adapter.migrations });
    await adapter.updateGlobal(g("site"), { name: "n", tagline: "t" });
    const files = chainOf(first[0].ops, [
      { op: "dropField", target: site, name: "tagline" },
      { op: "renameEntity", target: site, to: "settings" },
    ]);
    await migrateUp({ files, driver: adapter.migrations, allowDestructive: "all" });
    expect(await adapter.findGlobal(g("settings"))).toEqual({ name: "n" });
    expect(await adapter.findGlobal(g("site"))).toBeUndefined();
  });
});
