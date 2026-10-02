import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withIndex } from "../schema/snapshot.js";
import {
  chainOf,
  collection,
  collectionAfter,
  createEntity,
  global,
  globalAfter,
  textSpec,
} from "./builders.js";
import { CONVERSION_CASES } from "./conversion-cases.js";
import { rowsOf, up } from "./contract-support.js";
import type { ContractHarness, ContractWorld } from "./types.js";

const items = collection("items");
const config = global("config");
const int = { type: "number", kind: "integer", index: false } as const;
const rel = (target: string) =>
  ({ type: "relation", collection: target, multiple: false, index: false }) as const;

/**
 * The contract for each op, on real data: insert through the adapter, migrate, read back through
 * the adapter.
 * @param name - Driver name, for the suite title.
 * @param h - The harness that builds a fresh driver.
 */
export function defineOpsContract(name: string, h: ContractHarness): void {
  describe(`${name}: ops on real data`, () => {
    let world: ContractWorld;
    beforeEach(async () => {
      world = await h.make();
    });
    afterEach(async () => {
      await world.cleanup();
    });

    it("createEntity: a new collection is empty and accepts rows; a new global has no document", async () => {
      const files = chainOf([
        createEntity(items, { title: textSpec }),
        createEntity(config, { name: textSpec }),
      ]);
      await up(world, files);
      const c = collectionAfter(files, "items");
      const g = globalAfter(files, "config");
      expect(await rowsOf(world, c)).toEqual([]);
      expect(await world.adapter.findGlobal(g)).toBeUndefined();
      await world.adapter.insert(c, { title: "a" });
      await world.adapter.updateGlobal(g, { name: "site" });
      expect(await rowsOf(world, c)).toEqual([{ title: "a" }]);
      expect(await world.adapter.findGlobal(g)).toMatchObject({ name: "site" });
    });

    it("addField: existing rows are untouched and gain no value", async () => {
      const first = chainOf([createEntity(items, { title: textSpec })]);
      await up(world, first);
      await world.adapter.insert(collectionAfter(first, "items"), { title: "old" });
      const files = chainOf(first[0].ops, [
        { op: "addField", target: items, name: "qty", spec: int },
      ]);
      await up(world, files);
      const c = collectionAfter(files, "items");
      await world.adapter.insert(c, { title: "new", qty: 3 });
      expect(await rowsOf(world, c)).toEqual([
        { title: "old" },
        { title: "new", qty: 3 },
      ]);
    });

    it("dropField: the value disappears from every row, the other fields stay", async () => {
      const first = chainOf([createEntity(items, { title: textSpec, note: textSpec })]);
      await up(world, first);
      const c1 = collectionAfter(first, "items");
      await world.adapter.insert(c1, { title: "a", note: "x" });
      await world.adapter.insert(c1, { title: "b" });
      const files = chainOf(first[0].ops, [
        { op: "dropField", target: items, name: "note" },
      ]);
      await up(world, files);
      expect(await rowsOf(world, collectionAfter(files, "items"))).toEqual([
        { title: "a" },
        { title: "b" },
      ]);
    });

    it("renameField: values move to the new name, rows without the value stay without", async () => {
      const first = chainOf([createEntity(items, { title: textSpec })]);
      await up(world, first);
      const c1 = collectionAfter(first, "items");
      await world.adapter.insert(c1, { title: "a" });
      await world.adapter.insert(c1, {});
      const files = chainOf(first[0].ops, [
        { op: "renameField", target: items, from: "title", to: "name" },
      ]);
      await up(world, files);
      expect(await rowsOf(world, collectionAfter(files, "items"))).toEqual([
        { name: "a" },
        {},
      ]);
    });

    it("renameField and dropField also apply to a global's document", async () => {
      const first = chainOf([
        createEntity(config, { name: textSpec, tagline: textSpec }),
      ]);
      await up(world, first);
      await world.adapter.updateGlobal(globalAfter(first, "config"), {
        name: "site",
        tagline: "hi",
      });
      const files = chainOf(first[0].ops, [
        { op: "renameField", target: config, from: "name", to: "title" },
        { op: "dropField", target: config, name: "tagline" },
      ]);
      await up(world, files);
      const doc = await world.adapter.findGlobal(globalAfter(files, "config"));
      expect(doc).toMatchObject({ title: "site" });
      expect(doc).not.toHaveProperty("tagline");
      expect(doc).not.toHaveProperty("name");
    });

    const alterField = h.unsupportedOps?.includes("alterField") ? it.skip : it;
    alterField(
      "alterField: every row of the conversion matrix ends as specified",
      async () => {
        const cases = CONVERSION_CASES;
        const names = cases.map((_, i) => `c${i}`);
        // `tags` and `labels` are the relation targets the cases point at.
        const create = chainOf([
          createEntity(collection("tags"), {}),
          createEntity(collection("labels"), {}),
          ...names.map((slug, i) =>
            createEntity(collection(slug), { f: withIndex(cases[i].from, false) }),
          ),
        ]);
        await up(world, create);
        await Promise.all(
          cases.map((k, i) => {
            const input = k.input === undefined ? {} : { f: k.input };
            return world.adapter.insert(collectionAfter(create, names[i]), input);
          }),
        );
        const files = chainOf(
          create[0].ops,
          cases.map((k, i) => ({
            op: "alterField" as const,
            target: collection(names[i]),
            name: "f",
            from: k.from,
            to: k.to,
          })),
        );
        await up(world, files);
        for (const [i, k] of cases.entries()) {
          const [row] = await rowsOf(world, collectionAfter(files, names[i]));
          const expected = k.output === undefined ? {} : { f: k.output };
          expect(
            row,
            `case ${i}: ${JSON.stringify(k.from)} -> ${JSON.stringify(k.to)}`,
          ).toEqual(expected);
        }
      },
    );

    it("renameEntity: rows follow the collection, a global keeps its document", async () => {
      const first = chainOf([
        createEntity(items, { title: textSpec }),
        createEntity(config, { name: textSpec }),
      ]);
      await up(world, first);
      await world.adapter.insert(collectionAfter(first, "items"), { title: "a" });
      await world.adapter.updateGlobal(globalAfter(first, "config"), { name: "site" });
      const files = chainOf(first[0].ops, [
        { op: "renameEntity", target: items, to: "things" },
        { op: "renameEntity", target: config, to: "settings" },
      ]);
      await up(world, files);
      expect(await rowsOf(world, collectionAfter(files, "things"))).toEqual([
        { title: "a" },
      ]);
      expect(await rowsOf(world, collectionAfter(first, "items"))).toEqual([]);
      expect(
        await world.adapter.findGlobal(globalAfter(files, "settings")),
      ).toMatchObject({
        name: "site",
      });
    });

    it("dropEntity: the data is gone and a later createEntity starts empty", async () => {
      const first = chainOf([
        createEntity(items, { title: textSpec }),
        createEntity(config, { name: textSpec }),
      ]);
      await up(world, first);
      await world.adapter.insert(collectionAfter(first, "items"), { title: "a" });
      await world.adapter.updateGlobal(globalAfter(first, "config"), { name: "site" });
      const dropped = chainOf(first[0].ops, [
        { op: "dropEntity", target: items },
        { op: "dropEntity", target: config },
      ]);
      await up(world, dropped);
      const again = chainOf(...dropped.map((f) => f.ops), first[0].ops);
      await up(world, again);
      expect(await rowsOf(world, collectionAfter(first, "items"))).toEqual([]);
      expect(
        await world.adapter.findGlobal(globalAfter(first, "config")),
      ).toBeUndefined();
    });

    it("setIndex: toggling an index leaves the data alone", async () => {
      const first = chainOf([createEntity(items, { title: textSpec })]);
      await up(world, first);
      await world.adapter.insert(collectionAfter(first, "items"), { title: "a" });
      const files = chainOf(
        first[0].ops,
        [{ op: "setIndex", target: items, name: "title", index: true }],
        [{ op: "setIndex", target: items, name: "title", index: false }],
      );
      await up(world, files);
      expect(await rowsOf(world, collectionAfter(files, "items"))).toEqual([
        { title: "a" },
      ]);
    });

    it("mutually-referencing collections can be created together", async () => {
      const files = chainOf([
        createEntity(collection("a"), { other: rel("b") }),
        createEntity(collection("b"), { other: rel("a") }),
      ]);
      await up(world, files);
      const a = await world.adapter.insert(collectionAfter(files, "a"), {});
      await world.adapter.insert(collectionAfter(files, "b"), { other: a.id });
      expect(await rowsOf(world, collectionAfter(files, "b"))).toEqual([{ other: a.id }]);
    });

    it("an op that is already satisfied (effect noop) leaves the data alone", async () => {
      const first = chainOf([createEntity(items, { title: textSpec })]);
      await up(world, first);
      await world.adapter.insert(collectionAfter(first, "items"), { title: "a" });
      const files = chainOf(first[0].ops, [
        { op: "addField", target: items, name: "title", spec: textSpec },
        { op: "dropField", target: items, name: "ghost" },
      ]);
      expect((await up(world, files)).applied).toEqual([files[1].id]);
      expect(await rowsOf(world, collectionAfter(files, "items"))).toEqual([
        { title: "a" },
      ]);
    });

    it("running the same chain twice applies it once", async () => {
      const first = chainOf([createEntity(items, { title: textSpec })]);
      const files = chainOf(first[0].ops, [
        { op: "renameField", target: items, from: "title", to: "name" },
      ]);
      await up(world, [files[0]]);
      await world.adapter.insert(collectionAfter(first, "items"), { title: "a" });
      expect((await up(world, files)).applied).toEqual([files[1].id]);
      expect((await up(world, files)).applied).toEqual([]);
      expect(await rowsOf(world, collectionAfter(files, "items"))).toEqual([
        { name: "a" },
      ]);
    });
  });
}
