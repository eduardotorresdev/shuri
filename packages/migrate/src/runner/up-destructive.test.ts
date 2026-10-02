import { describe, expect, it } from "vitest";
import { DestructiveMigrationError } from "../errors/runner.js";
import { idAt, mig } from "../migration/test-support.js";
import { alter, dropField, text, textarea, int } from "../ops/test-support.js";
import { chain, ids, m3, newStore, posts, run } from "./test-support.js";

describe("migrateUp destructive migrations", () => {
  const drop = mig(idAt(4, "drop_body"), m3.id, [dropField(posts, "body")]);
  const lossy = mig(idAt(5, "text_to_int"), drop.id, [alter(posts, "title", text, int)]);
  const files = [...chain, drop, lossy];

  it("are refused before ANY pending migration runs, listing every unapproved op", async () => {
    const { driver } = newStore();
    const error = await run(files, driver).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DestructiveMigrationError);
    expect((error as DestructiveMigrationError).items).toEqual([
      { migration: drop.id, op: dropField(posts, "body") },
      { migration: lossy.id, op: lossy.ops[0] },
    ]);
    expect(await driver.applied()).toEqual([]);
  });

  it("are approved per migration id", async () => {
    const { driver } = newStore();
    const error = await run(files, driver, { allowDestructive: [drop.id] }).catch(
      (e: unknown) => e,
    );
    expect((error as DestructiveMigrationError).items.map((i) => i.migration)).toEqual([
      lossy.id,
    ]);
    expect(await driver.applied()).toEqual([]);
    const result = await run(files, driver, { allowDestructive: [drop.id, lossy.id] });
    expect(result.applied).toEqual(ids(files));
  });

  it('are approved all at once with "all"', async () => {
    const { driver } = newStore();
    expect((await run(files, driver, { allowDestructive: "all" })).applied).toEqual(
      ids(files),
    );
  });

  it("a lossless alteration and a drop that is already satisfied need no approval", async () => {
    const { driver } = newStore();
    const safe = mig(idAt(4, "safe"), m3.id, [
      alter(posts, "title", text, textarea),
      dropField(posts, "ghost"),
    ]);
    expect((await run([...chain, safe], driver)).applied).toEqual(ids([...chain, safe]));
  });

  it("an approved migration that already ran is not asked about again", async () => {
    const { driver } = newStore();
    await run([...chain, drop], driver, { allowDestructive: [drop.id] });
    await expect(run([...chain, drop], driver)).resolves.toMatchObject({ applied: [] });
  });
});
