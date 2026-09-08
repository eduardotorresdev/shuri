import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { StoreAdapter } from "@shuri/store";
import { RecordNotFoundError } from "@shuri/store";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryAdapter } from "./memory-adapter.js";

const siteSettings: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [
    { type: "text", name: "name", required: true },
    { type: "number", name: "price", kind: "float", sign: "positive" },
  ],
};

describe("createMemoryAdapter", () => {
  let adapter: StoreAdapter;

  beforeEach(() => {
    adapter = createMemoryAdapter();
  });

  it("inserts a record and assigns it a unique id", async () => {
    const a = await adapter.insert(services, { name: "Haircut", price: 40 });
    const b = await adapter.insert(services, { name: "Manicure", price: 25 });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("finds a record by id, scoped to its collection", async () => {
    const record = await adapter.insert(services, {
      name: "Haircut",
      price: 40,
    });
    expect(await adapter.findOne(services, record.id)).toEqual(record);
    expect(await adapter.findOne(services, "missing")).toBeUndefined();
  });

  it("updates an existing record, merging fields", async () => {
    const record = await adapter.insert(services, {
      name: "Haircut",
      price: 40,
    });
    const updated = await adapter.update(services, record.id, { price: 50 });
    expect(updated).toEqual({ id: record.id, name: "Haircut", price: 50 });
  });

  it("throws when updating a record that doesn't exist", async () => {
    await expect(adapter.update(services, "missing", { price: 50 })).rejects.toThrow(
      RecordNotFoundError,
    );
  });

  it("deletes a record", async () => {
    const record = await adapter.insert(services, {
      name: "Haircut",
      price: 40,
    });
    await adapter.delete(services, record.id);
    expect(await adapter.findOne(services, record.id)).toBeUndefined();
  });

  it("keeps separate tables per collection", async () => {
    const otherCollection: CollectionSchema = { ...services, slug: "products" };
    const service = await adapter.insert(services, { name: "Haircut" });
    await adapter.insert(otherCollection, { name: "Shampoo" });

    expect(await adapter.findMany(services)).toEqual([service]);
  });

  describe("findMany", () => {
    beforeEach(async () => {
      await adapter.insert(services, { name: "Haircut", price: 40 });
      await adapter.insert(services, { name: "Manicure", price: 25 });
      await adapter.insert(services, { name: "Massage", price: 80 });
    });

    it("filters using where operators", async () => {
      const affordable = await adapter.findMany(services, {
        where: { price: { op: "lte", value: 50 } },
      });
      expect(affordable.map((r) => r.name).toSorted()).toEqual(["Haircut", "Manicure"]);

      const exact = await adapter.findMany(services, {
        where: { name: { op: "eq", value: "Massage" } },
      });
      expect(exact.map((r) => r.name)).toEqual(["Massage"]);

      const inList = await adapter.findMany(services, {
        where: { name: { op: "in", value: ["Haircut", "Massage"] } },
      });
      expect(inList.map((r) => r.name).toSorted()).toEqual(["Haircut", "Massage"]);
    });

    it("sorts by a field and direction", async () => {
      const sorted = await adapter.findMany(services, {
        orderBy: [{ field: "price", direction: "desc" }],
      });
      expect(sorted.map((r) => r.name)).toEqual(["Massage", "Haircut", "Manicure"]);
    });

    it("paginates with limit and offset", async () => {
      const page = await adapter.findMany(services, {
        orderBy: [{ field: "price" }],
        limit: 1,
        offset: 1,
      });
      expect(page.map((r) => r.name)).toEqual(["Haircut"]);
    });
  });

  it("counts records matching a query", async () => {
    await adapter.insert(services, { name: "Haircut", price: 40 });
    await adapter.insert(services, { name: "Massage", price: 80 });
    expect(
      await adapter.count(services, {
        where: { price: { op: "gt", value: 50 } },
      }),
    ).toBe(1);
  });

  describe("global", () => {
    it("returns undefined before the first update", async () => {
      expect(await adapter.findGlobal(siteSettings)).toBeUndefined();
    });

    it("updates the global record, merging fields", async () => {
      await adapter.updateGlobal(siteSettings, { name: "Acme" });
      expect(await adapter.findGlobal(siteSettings)).toEqual({ name: "Acme" });

      await adapter.updateGlobal(siteSettings, { name: "Acme Co" });
      expect(await adapter.findGlobal(siteSettings)).toEqual({
        name: "Acme Co",
      });
    });

    it("keeps a separate record per global slug", async () => {
      const otherGlobal: GlobalSchema = { ...siteSettings, slug: "seo" };
      await adapter.updateGlobal(siteSettings, { name: "Acme" });
      await adapter.updateGlobal(otherGlobal, { name: "SEO" });

      expect(await adapter.findGlobal(siteSettings)).toEqual({ name: "Acme" });
      expect(await adapter.findGlobal(otherGlobal)).toEqual({ name: "SEO" });
    });
  });
});

describe("createMemoryAdapter where", () => {
  it("ANDs several filters on the same field", async () => {
    const adapter = createMemoryAdapter();
    await adapter.insert(services, { name: "Cheap", price: 5 });
    const mid = await adapter.insert(services, { name: "Mid", price: 50 });
    await adapter.insert(services, { name: "Dear", price: 500 });

    const found = await adapter.findMany(services, {
      where: {
        price: [
          { op: "gt", value: 10 },
          { op: "lt", value: 100 },
        ],
      },
    });
    expect(found).toEqual([mid]);
  });
});

const sessions: CollectionSchema = {
  slug: "sessions",
  title: "Sessions",
  singular: "Session",
  plural: "Sessions",
  fields: [
    { type: "text", name: "tokenHash", required: true, index: true },
    { type: "text", name: "user", required: true },
  ],
};

describe("createMemoryAdapter indexes", () => {
  let adapter: StoreAdapter;

  beforeEach(async () => {
    adapter = createMemoryAdapter();
    await adapter.insert(sessions, { tokenHash: "a", user: "ada" });
    await adapter.insert(sessions, { tokenHash: "b", user: "ada" });
    await adapter.insert(sessions, { tokenHash: "b", user: "bob" });
  });

  it("answers an eq filter on an indexed field with exactly the records holding the value", async () => {
    const found = await adapter.findMany(sessions, {
      where: { tokenHash: { op: "eq", value: "b" } },
    });
    expect(found.map((record) => record["user"]).toSorted()).toEqual(["ada", "bob"]);
    expect(
      await adapter.findMany(sessions, {
        where: { tokenHash: { op: "eq", value: "zzz" } },
      }),
    ).toEqual([]);
  });

  it("still applies the other filters to the indexed candidates", async () => {
    const found = await adapter.findMany(sessions, {
      where: { tokenHash: { op: "eq", value: "b" }, user: { op: "eq", value: "bob" } },
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.["user"]).toBe("bob");
  });

  it("follows an update that moves a record to another indexed value", async () => {
    const [record] = await adapter.findMany(sessions, {
      where: { tokenHash: { op: "eq", value: "a" } },
    });
    await adapter.update(sessions, (record as { id: string }).id, { tokenHash: "c" });

    expect(
      await adapter.findMany(sessions, {
        where: { tokenHash: { op: "eq", value: "a" } },
      }),
    ).toEqual([]);
    expect(
      await adapter.findMany(sessions, {
        where: { tokenHash: { op: "eq", value: "c" } },
      }),
    ).toHaveLength(1);
  });

  it("forgets a deleted record", async () => {
    const [record] = await adapter.findMany(sessions, {
      where: { tokenHash: { op: "eq", value: "a" } },
    });
    await adapter.delete(sessions, (record as { id: string }).id);

    expect(
      await adapter.findMany(sessions, {
        where: { tokenHash: { op: "eq", value: "a" } },
      }),
    ).toEqual([]);
    expect(await adapter.count(sessions)).toBe(2);
  });

  it("pages an unfiltered, unsorted query in insertion order", async () => {
    const pageOne = await adapter.findMany(sessions, { limit: 2 });
    const pageTwo = await adapter.findMany(sessions, { offset: 2, limit: 2 });
    expect(pageOne.map((record) => record["tokenHash"])).toEqual(["a", "b"]);
    expect(pageTwo.map((record) => record["tokenHash"])).toEqual(["b"]);
    expect(await adapter.findMany(sessions, { limit: 0 })).toEqual([]);
  });

  it("counts an unfiltered query honouring offset and limit", async () => {
    expect(await adapter.count(sessions)).toBe(3);
    expect(await adapter.count(sessions, { offset: 1 })).toBe(2);
    expect(await adapter.count(sessions, { offset: 1, limit: 1 })).toBe(1);
    expect(await adapter.count(sessions, { offset: 5 })).toBe(0);
  });
});
