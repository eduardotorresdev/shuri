import type { MigrationOp } from "../ops/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chainOf,
  collection,
  collectionAfter,
  createEntity,
  textSpec,
} from "./builders.js";
import { rowsOf, up } from "./contract-support.js";
import type { ContractHarness, ContractWorld } from "./types.js";

const items = collection("items");
const int = { type: "number", kind: "integer", index: false } as const;

const alter = {
  op: "alterField",
  target: items,
  name: "qty",
  from: { type: "text" },
  to: { type: "number", kind: "integer" },
} as const;

// Steps that each touch data: rename, convert, drop, add, rename the collection. A driver that
// cannot convert yet (`unsupportedOps`) runs the chain without the conversion.
const stepsFor = (withAlter: boolean): MigrationOp[] => [
  { op: "renameField", target: items, from: "title", to: "name" },
  ...(withAlter ? [alter] : []),
  { op: "dropField", target: items, name: "legacy" },
  { op: "addField", target: items, name: "extra", spec: int },
  { op: "renameEntity", target: items, to: "products" },
];
const setup = chainOf([
  createEntity(items, { title: textSpec, qty: textSpec, legacy: textSpec }),
]);

const seed = [
  { title: "a", qty: "1", legacy: "x" },
  { title: "b", qty: "oops", legacy: "y" },
];

/**
 * The contract for failures halfway through a migration, at every step: an atomic driver leaves
 * nothing behind; any other leaves a `running` entry; both finish when run again.
 * @param name - Driver name, for the suite title.
 * @param h - The harness that builds a fresh driver.
 */
export function defineCrashContract(name: string, h: ContractHarness): void {
  describe(`${name}: failure and re-run`, () => {
    const withAlter = !h.unsupportedOps?.includes("alterField");
    const steps = stepsFor(withAlter);
    const files = chainOf(setup[0].ops, steps);
    const finalRows = withAlter
      ? [{ name: "a", qty: 1 }, { name: "b" }]
      : [
          { name: "a", qty: "1" },
          { name: "b", qty: "oops" },
        ];
    let world: ContractWorld;
    beforeEach(async () => {
      world = await h.make();
      await up(world, [files[0]]);
      for (const row of seed) {
        await world.adapter.insert(collectionAfter(setup, "items"), row);
      }
    });
    afterEach(async () => {
      await world.cleanup();
    });

    for (let step = 0; step <= steps.length; step++) {
      it(`a failure after step ${step} of ${steps.length} is recoverable by running again`, async () => {
        const { atomicity } = world.adapter.migrations.capabilities;
        world.injectFailure(step);
        await expect(up(world, files)).rejects.toThrow();

        const journal = await world.adapter.migrations.applied();
        if (atomicity === "migration") {
          expect(journal.map((e) => e.id)).toEqual([files[0].id]);
          expect(await rowsOf(world, collectionAfter(setup, "items"))).toEqual(seed);
        } else {
          expect(journal.map((e) => [e.id, e.status])).toEqual([
            [files[0].id, "done"],
            [files[1].id, "running"],
          ]);
        }

        expect((await up(world, files)).applied).toEqual([files[1].id]);
        const done = await world.adapter.migrations.applied();
        expect(done.map((e) => [e.id, e.status])).toEqual([
          [files[0].id, "done"],
          [files[1].id, "done"],
        ]);
        expect(await rowsOf(world, collectionAfter(files, "products"))).toEqual(
          finalRows,
        );
        expect(await rowsOf(world, collectionAfter(setup, "items"))).toEqual([]);
      });
    }
  });
}
