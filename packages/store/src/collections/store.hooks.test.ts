import type { CollectionSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { describe, expect, it, vi } from "vitest";
import { RecordValidationError } from "../errors.js";
import { createStore } from "../store.js";
import { createFakeAdapter } from "../test-support.js";
import { RecordNotFoundError } from "./errors.js";

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

const others: CollectionSchema = {
  slug: "others",
  title: "Others",
  singular: "Other",
  plural: "Others",
  fields: [{ type: "text", name: "name", required: true }],
};

function storeWith(schema: CollectionSchema, adapter = createFakeAdapter()) {
  return createStore(createCore({ collections: [schema] }), adapter);
}

describe("CollectionStore hooks", () => {
  it("runs schema-declared hooks before registered ones, and both before the caller's await resolves", async () => {
    const order: string[] = [];
    const store = storeWith({
      ...services,
      hooks: {
        afterChange: [
          () => {
            order.push("schema");
          },
        ],
      },
    });
    store.hooks.onCollection("services", "afterChange", () => {
      order.push("registered");
    });
    store.hooks.onCollection("*", "afterChange", () => {
      order.push("wildcard");
    });

    await store.collection("services").insert({ name: "Haircut" });

    expect(order).toEqual(["schema", "registered", "wildcard"]);
  });

  it("lets beforeValidate and beforeChange replace the data, in that order around validation", async () => {
    const adapter = createFakeAdapter();
    const store = storeWith(
      {
        ...services,
        hooks: {
          // Fills in what validation is about to require: a beforeChange couldn't, it runs after.
          beforeValidate: [({ data }) => ({ ...data, name: data.name ?? "Unnamed" })],
          beforeChange: [({ data }) => ({ ...data, price: 10 })],
        },
      },
      adapter,
    );

    const record = await store.collection("services").insert({});

    expect(record).toMatchObject({ name: "Unnamed", price: 10 });
    expect(await adapter.findOne(services, record.id)).toMatchObject({
      name: "Unnamed",
      price: 10,
    });
  });

  it("aborts the write when a before hook throws, without touching the adapter", async () => {
    const adapter = createFakeAdapter();
    const spiedInsert = vi.spyOn(adapter, "insert");
    const store = storeWith(services, adapter);
    const afterChange = vi.fn();
    store.hooks.onCollection("services", "beforeChange", () => {
      throw new Error("not today");
    });
    store.hooks.onCollection("services", "afterChange", afterChange);

    await expect(
      store.collection("services").insert({ name: "Haircut" }),
    ).rejects.toThrow("not today");
    expect(spiedInsert).not.toHaveBeenCalled();
    expect(afterChange).not.toHaveBeenCalled();
  });

  it("hands an update's pre-image to beforeChange as originalDoc and to afterChange as previousDoc", async () => {
    const store = storeWith(services);
    const collection = store.collection("services");
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    const seen: unknown[] = [];
    store.hooks.onCollection("services", "beforeChange", (args) => {
      seen.push({
        operation: args.operation,
        id: args.id,
        originalDoc: args.originalDoc,
      });
    });
    store.hooks.onCollection("services", "afterChange", (args) => {
      seen.push({
        operation: args.operation,
        doc: args.doc,
        previousDoc: args.previousDoc,
      });
    });

    await collection.update(inserted.id, { price: 50 });

    expect(seen).toEqual([
      { operation: "update", id: inserted.id, originalDoc: inserted },
      {
        operation: "update",
        doc: { id: inserted.id, name: "Haircut", price: 50 },
        previousDoc: inserted,
      },
    ]);
  });

  it("runs no after hook for a write the field validation or the adapter rejected", async () => {
    const store = storeWith(services);
    const afterChange = vi.fn();
    store.hooks.onCollection("services", "afterChange", afterChange);

    await expect(store.collection("services").insert({ price: 40 })).rejects.toThrow(
      RecordValidationError,
    );
    await expect(
      store.collection("services").update("missing", { price: 50 }),
    ).rejects.toThrow(RecordNotFoundError);
    expect(afterChange).not.toHaveBeenCalled();
  });

  it("hands the deleted record to beforeDelete and afterDelete, undefined for an unknown id", async () => {
    const adapter = createFakeAdapter();
    const store = storeWith(services, adapter);
    const collection = store.collection("services");
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    const seen: unknown[] = [];
    store.hooks.onCollection("services", "beforeDelete", ({ id, doc }) => {
      seen.push(["before", id, doc]);
    });
    store.hooks.onCollection("services", "afterDelete", ({ id, doc }) => {
      seen.push(["after", id, doc]);
    });

    await collection.delete(inserted.id);
    await collection.delete("missing");

    expect(seen).toEqual([
      ["before", inserted.id, inserted],
      ["after", inserted.id, inserted],
      ["before", "missing", undefined],
      ["after", "missing", undefined],
    ]);
    expect(await adapter.findOne(services, inserted.id)).toBeUndefined();
  });

  it("aborts a delete when beforeDelete throws, leaving the record in place", async () => {
    const store = storeWith(services);
    const collection = store.collection("services");
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    store.hooks.onCollection("services", "beforeDelete", () => {
      throw new Error("keep it");
    });

    await expect(collection.delete(inserted.id)).rejects.toThrow("keep it");
    expect(await collection.findOne(inserted.id)).toEqual(inserted);
  });

  it("lets beforeRead replace a list's query and afterRead transform each record", async () => {
    const adapter = createFakeAdapter();
    const spiedFindMany = vi.spyOn(adapter, "findMany");
    const store = storeWith(
      {
        ...services,
        hooks: {
          beforeRead: [
            ({ operation, query }) =>
              operation === "list" ? { ...query, limit: 1 } : undefined,
          ],
          afterRead: [
            ({ doc, operation }) => ({ ...doc, name: `${doc.name} (${operation})` }),
          ],
        },
      },
      adapter,
    );
    const collection = store.collection("services");
    const inserted = await collection.insert({ name: "Haircut" });
    await collection.insert({ name: "Massage" });

    const listed = await collection.findMany({ offset: 0 });
    const fetched = await collection.get(inserted.id);

    // The fake adapter ignores the query, so the replacement is asserted on what it received.
    expect(spiedFindMany).toHaveBeenLastCalledWith(expect.anything(), {
      offset: 0,
      limit: 1,
    });
    expect(listed.map((record) => record.name)).toEqual([
      "Haircut (list)",
      "Massage (list)",
    ]);
    expect(fetched.name).toBe("Haircut (get)");
    expect(await collection.findOne("missing")).toBeUndefined();
  });

  it("passes the caller's context through to every hook, and an empty one by default", async () => {
    const store = storeWith(services);
    const contexts: unknown[] = [];
    store.hooks.onCollection("services", "afterChange", ({ context }) => {
      contexts.push(context);
    });
    const request = new Request("http://localhost/collections/services");

    await store.collection("services").insert({ name: "Haircut" });
    await store.collection("services").insert({ name: "Massage" }, { request });

    expect(contexts).toEqual([{}, { request }]);
  });

  it("runs a hook only for its own collection, and stops once unsubscribed", async () => {
    const store = createStore(
      createCore({ collections: [services, others] }),
      createFakeAdapter(),
    );
    const seen: string[] = [];
    const unsubscribe = store.hooks.onCollection("services", "afterChange", ({ doc }) => {
      seen.push(String(doc.name));
    });

    await store.collection("others").insert({ name: "Ignored" });
    await store.collection("services").insert({ name: "Haircut" });
    unsubscribe();
    await store.collection("services").insert({ name: "Massage" });

    expect(seen).toEqual(["Haircut"]);
  });
});
