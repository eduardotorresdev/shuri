import { describe, expect, it } from "vitest";
import { createFakeCollectionStore } from "../collections/test-support.js";
import { HiddenFieldError } from "./errors.js";
import { publicCollection } from "./public-collection.js";
import { accountsSchema } from "./test-support.js";

function setup() {
  const store = createFakeCollectionStore(accountsSchema);
  return { store, api: publicCollection(store) };
}

describe("publicCollection", () => {
  it("strips hidden fields from every read while the store keeps them", async () => {
    const { store, api } = setup();
    const stored = await store.insert({ email: "a@b.com", passwordHash: "secret" });

    expect(await api.get(stored.id)).toEqual({ id: stored.id, email: "a@b.com" });
    expect(await api.findMany()).toEqual([{ id: stored.id, email: "a@b.com" }]);
    expect(await store.findOne(stored.id)).toMatchObject({ passwordHash: "secret" });
  });

  it("strips hidden fields from what a write echoes back", async () => {
    const { api } = setup();
    const created = await api.insert({ email: "a@b.com" });
    expect(created).not.toHaveProperty("passwordHash");

    const updated = await api.update(created.id, { email: "c@d.com" });
    expect(updated).toEqual({ id: created.id, email: "c@d.com" });
  });

  it("refuses a write naming a hidden field", async () => {
    const { api } = setup();
    await expect(api.insert({ passwordHash: "chosen" })).rejects.toThrow(
      HiddenFieldError,
    );
    const created = await api.insert({ email: "a@b.com" });
    await expect(api.update(created.id, { passwordHash: "chosen" })).rejects.toThrow(
      HiddenFieldError,
    );
  });

  it("refuses a query naming a hidden field", async () => {
    const { api } = setup();
    await expect(
      api.findMany({ where: { passwordHash: { op: "eq", value: "x" } } }),
    ).rejects.toThrow(HiddenFieldError);
  });

  it("deletes through to the store", async () => {
    const { store, api } = setup();
    const stored = await store.insert({ email: "a@b.com" });
    await api.delete(stored.id);
    expect(await store.findOne(stored.id)).toBeUndefined();
  });
});
