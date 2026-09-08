import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { RecordNotFoundError, type StoreAdapter } from "@shuri/store";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMongoAdapter } from "../mongo-adapter.js";

/**
 * Runs against a real `mongod`: `MONGO_URL` when set (e.g. a docker container in CI), otherwise a
 * throwaway `mongodb-memory-server` instance.
 */
let server: MongoMemoryServer | undefined;
let client: MongoClient;
let adapter: StoreAdapter;

beforeAll(async () => {
  let uri = process.env.MONGO_URL;
  if (!uri) {
    server = await MongoMemoryServer.create();
    uri = server.getUri();
  }
  client = await MongoClient.connect(uri);
  adapter = createMongoAdapter({ db: client.db("shuri-store-mongo-test") });
}, 120_000);

afterAll(async () => {
  await client.db("shuri-store-mongo-test").dropDatabase();
  await client.close();
  await server?.stop();
});

beforeEach(async () => {
  await client.db("shuri-store-mongo-test").dropDatabase();
});

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

describe("createMongoAdapter", () => {
  it("inserts a record with a generated string id and finds it back", async () => {
    const record = await adapter.insert(services, { name: "Haircut", price: 40 });
    expect(typeof record.id).toBe("string");
    expect(record).toEqual({ id: record.id, name: "Haircut", price: 40 });
    expect(await adapter.findOne(services, record.id)).toEqual(record);
  });

  it("never stores a caller-provided id inside the document body", async () => {
    const record = await adapter.insert(services, { id: "forged", name: "Haircut" });
    expect(record.id).not.toBe("forged");
    const raw = await client
      .db("shuri-store-mongo-test")
      .collection("services")
      .findOne({ _id: record.id as never });
    expect(raw).toEqual({ _id: record.id, name: "Haircut" });
  });

  it("returns undefined for an unknown id", async () => {
    expect(await adapter.findOne(services, "missing")).toBeUndefined();
  });

  it("keeps collections apart by slug", async () => {
    const products: CollectionSchema = { ...services, slug: "products" };
    await adapter.insert(services, { name: "Haircut" });
    expect(await adapter.findMany(products)).toEqual([]);
  });

  it("updates with a shallow merge and returns the merged record", async () => {
    const record = await adapter.insert(services, { name: "Haircut", price: 40 });
    const updated = await adapter.update(services, record.id, { price: 45 });
    expect(updated).toEqual({ id: record.id, name: "Haircut", price: 45 });
    expect(await adapter.findOne(services, record.id)).toEqual(updated);
  });

  it("returns the current record when the update payload is empty", async () => {
    const record = await adapter.insert(services, { name: "Haircut" });
    expect(await adapter.update(services, record.id, {})).toEqual(record);
  });

  it("throws RecordNotFoundError when updating an unknown id", async () => {
    await expect(
      adapter.update(services, "missing", { price: 1 }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(adapter.update(services, "missing", {})).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it("deletes a record and tolerates an unknown id", async () => {
    const record = await adapter.insert(services, { name: "Haircut" });
    await adapter.delete(services, record.id);
    expect(await adapter.findOne(services, record.id)).toBeUndefined();
    await expect(adapter.delete(services, "missing")).resolves.toBeUndefined();
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

      const notExact = await adapter.findMany(services, {
        where: { name: { op: "ne", value: "Massage" } },
      });
      expect(notExact.map((r) => r.name).toSorted()).toEqual(["Haircut", "Manicure"]);

      const inList = await adapter.findMany(services, {
        where: { name: { op: "in", value: ["Haircut", "Massage"] } },
      });
      expect(inList.map((r) => r.name).toSorted()).toEqual(["Haircut", "Massage"]);

      const containing = await adapter.findMany(services, {
        where: { name: { op: "contains", value: "Ma" } },
      });
      expect(containing.map((r) => r.name).toSorted()).toEqual(["Manicure", "Massage"]);
    });

    it("treats contains as a literal substring, not a regex", async () => {
      await adapter.insert(services, { name: "A.B", price: 1 });
      const found = await adapter.findMany(services, {
        where: { name: { op: "contains", value: "A.B" } },
      });
      expect(found.map((r) => r.name)).toEqual(["A.B"]);
      const dot = await adapter.findMany(services, {
        where: { name: { op: "contains", value: "." } },
      });
      expect(dot.map((r) => r.name)).toEqual(["A.B"]);
    });

    it("ANDs several filters on the same field", async () => {
      const found = await adapter.findMany(services, {
        where: {
          price: [
            { op: "gt", value: 30 },
            { op: "lt", value: 50 },
          ],
        },
      });
      expect(found.map((r) => r.name)).toEqual(["Haircut"]);
    });

    it("filters by id", async () => {
      const first = await adapter.insert(services, { name: "Waxing", price: 30 });
      const found = await adapter.findMany(services, {
        where: { id: { op: "eq", value: first.id } },
      });
      expect(found).toEqual([first]);
    });

    it("sorts by a field and direction", async () => {
      const sorted = await adapter.findMany(services, {
        orderBy: [{ field: "price", direction: "desc" }],
      });
      expect(sorted.map((r) => r.name)).toEqual(["Massage", "Haircut", "Manicure"]);
    });

    it("returns nothing for limit 0 instead of Mongo's 'no limit'", async () => {
      expect(await adapter.findMany(services, { limit: 0 })).toEqual([]);
      expect(await adapter.count(services, { limit: 0 })).toBe(0);
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

  it("counts records matching a query, honouring offset and limit", async () => {
    await adapter.insert(services, { name: "Haircut", price: 40 });
    await adapter.insert(services, { name: "Massage", price: 80 });
    await adapter.insert(services, { name: "Manicure", price: 25 });
    expect(await adapter.count(services)).toBe(3);
    expect(
      await adapter.count(services, { where: { price: { op: "gt", value: 30 } } }),
    ).toBe(2);
    expect(await adapter.count(services, { offset: 1, limit: 1 })).toBe(1);
  });

  describe("global", () => {
    it("returns undefined before the first update", async () => {
      expect(await adapter.findGlobal(siteSettings)).toBeUndefined();
    });

    it("updates the global record, merging fields", async () => {
      expect(await adapter.updateGlobal(siteSettings, { name: "Acme" })).toEqual({
        name: "Acme",
      });
      expect(await adapter.findGlobal(siteSettings)).toEqual({ name: "Acme" });

      await adapter.updateGlobal(siteSettings, { name: "Acme Co", tagline: "Hi" });
      expect(await adapter.findGlobal(siteSettings)).toEqual({
        name: "Acme Co",
        tagline: "Hi",
      });
      expect(await adapter.updateGlobal(siteSettings, { tagline: "Bye" })).toEqual({
        name: "Acme Co",
        tagline: "Bye",
      });
    });

    it("keeps a separate record per global slug", async () => {
      const otherGlobal: GlobalSchema = { ...siteSettings, slug: "seo" };
      await adapter.updateGlobal(siteSettings, { name: "Acme" });
      await adapter.updateGlobal(otherGlobal, { name: "SEO" });

      expect(await adapter.findGlobal(siteSettings)).toEqual({ name: "Acme" });
      expect(await adapter.findGlobal(otherGlobal)).toEqual({ name: "SEO" });
    });

    it("stores globals in a configurable collection", async () => {
      const custom = createMongoAdapter({
        db: client.db("shuri-store-mongo-test"),
        globalsCollection: "settings",
      });
      await custom.updateGlobal(siteSettings, { name: "Acme" });
      const raw = await client
        .db("shuri-store-mongo-test")
        .collection("settings")
        .findOne();
      expect(raw).toEqual({ _id: "site", name: "Acme" });
      expect(await adapter.findGlobal(siteSettings)).toBeUndefined();
    });
  });
});

describe("createMongoAdapter indexes", () => {
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

  it("creates an index for every field declared index: true on first touch", async () => {
    await adapter.insert(sessions, { tokenHash: "a", user: "ada" });

    const indexes = await client
      .db("shuri-store-mongo-test")
      .collection("sessions")
      .indexes();
    const keys = indexes.map((index) => Object.keys(index.key as object).join(","));
    expect(keys).toContain("tokenHash");
    expect(keys).not.toContain("user");
  });

  it("finds by the indexed field after the index exists", async () => {
    await adapter.insert(sessions, { tokenHash: "a", user: "ada" });
    await adapter.insert(sessions, { tokenHash: "b", user: "bob" });

    const found = await adapter.findMany(sessions, {
      where: { tokenHash: { op: "eq", value: "b" } },
    });
    expect(found.map((record) => record["user"])).toEqual(["bob"]);
  });
});
