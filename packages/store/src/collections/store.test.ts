import type { CollectionSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordValidationError } from "../errors.js";
import type { CollectionEvent, RecordEvent } from "../events/types.js";
import { createStore } from "../store.js";
import { createFakeAdapter } from "../test-support.js";
import { RecordNotFoundError } from "./errors.js";
import type { CollectionStore } from "./store.js";

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

const secrets: CollectionSchema = {
  slug: "secrets",
  title: "Secrets",
  singular: "Secret",
  plural: "Secrets",
  internal: true,
  fields: [
    { type: "text", name: "name", required: true },
    { type: "text", name: "token", hidden: true },
  ],
};

describe("CollectionStore", () => {
  let collection: CollectionStore;

  beforeEach(() => {
    const core = createCore({ collections: [services] });
    collection = createStore(core, createFakeAdapter()).collection("services");
  });

  it("exposes the schema it was bound to, hidden and internal metadata included", () => {
    expect(collection.schema).toBe(services);
  });

  it("is the complete view: a hidden field is readable and writable from here", async () => {
    const core = createCore({ collections: [secrets] });
    const store = createStore(core, createFakeAdapter()).collection("secrets");

    const record = await store.insert({ name: "Ada", token: "s3cret" });

    expect(record.token).toBe("s3cret");
    expect(await store.findOne(record.id)).toMatchObject({ token: "s3cret" });
  });

  it("inserts a record and assigns it an id", async () => {
    const record = await collection.insert({ name: "Haircut", price: 40 });
    expect(record.id).toBeTruthy();
    expect(record).toMatchObject({ name: "Haircut", price: 40 });
  });

  it("finds a record by id", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    expect(await collection.findOne(inserted.id)).toEqual(inserted);
    expect(await collection.findOne("missing")).toBeUndefined();
  });

  it("throws when getting a record that doesn't exist", async () => {
    await expect(collection.get("missing")).rejects.toThrow(RecordNotFoundError);
  });

  it("updates an existing record, merging fields", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    const updated = await collection.update(inserted.id, { price: 50 });
    expect(updated).toEqual({ id: inserted.id, name: "Haircut", price: 50 });
  });

  it("throws when updating a record that doesn't exist", async () => {
    await expect(collection.update("missing", { price: 50 })).rejects.toThrow(
      RecordNotFoundError,
    );
  });

  it("deletes a record", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    await collection.delete(inserted.id);
    expect(await collection.findOne(inserted.id)).toBeUndefined();
  });

  it("counts records", async () => {
    await collection.insert({ name: "Haircut", price: 40 });
    await collection.insert({ name: "Massage", price: 80 });
    expect(await collection.count()).toBe(2);
  });

  it("rejects an insert that doesn't satisfy the collection's fields, without touching the adapter", async () => {
    const adapter = createFakeAdapter();
    const spiedInsert = vi.spyOn(adapter, "insert");
    const invalidCollection = createStore(
      createCore({ collections: [services] }),
      adapter,
    ).collection("services");

    await expect(invalidCollection.insert({ price: 40 })).rejects.toThrow(
      RecordValidationError,
    );
    expect(spiedInsert).not.toHaveBeenCalled();
  });

  it("rejects an update that doesn't satisfy the collection's fields, without touching the adapter", async () => {
    const adapter = createFakeAdapter();
    const spiedUpdate = vi.spyOn(adapter, "update");
    const guardedCollection = createStore(
      createCore({ collections: [services] }),
      adapter,
    ).collection("services");
    const inserted = await guardedCollection.insert({
      name: "Haircut",
      price: 40,
    });
    spiedUpdate.mockClear();

    await expect(guardedCollection.update(inserted.id, { price: -10 })).rejects.toThrow(
      RecordValidationError,
    );
    expect(spiedUpdate).not.toHaveBeenCalled();
  });
});

describe("CollectionStore events", () => {
  let collection: CollectionStore;
  let events: CollectionEvent[];

  beforeEach(() => {
    const core = createCore({ collections: [services] });
    collection = createStore(core, createFakeAdapter()).collection("services");
    events = [];
  });

  it("emits a create carrying the persisted record, id included, before the insert resolves", async () => {
    collection.subscribe((event) => events.push(event));

    const record = await collection.insert({ name: "Haircut", price: 40 });

    // Asserted right after the await, with no timers: delivery is synchronous with the write.
    expect(events).toEqual([
      {
        scope: "collection",
        type: "create",
        collection: "services",
        id: record.id,
        record,
      },
    ]);
  });

  it("emits an update carrying the persisted record, not the patch", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    collection.subscribe((event) => events.push(event));

    await collection.update(inserted.id, { price: 50 });

    expect(events).toEqual([
      {
        scope: "collection",
        type: "update",
        collection: "services",
        id: inserted.id,
        record: { id: inserted.id, name: "Haircut", price: 50 },
      },
    ]);
  });

  it("emits a delete carrying only the collection and the id", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    collection.subscribe((event) => events.push(event));

    await collection.delete(inserted.id);

    expect(events).toEqual([
      { scope: "collection", type: "delete", collection: "services", id: inserted.id },
    ]);
    expect(events[0]).not.toHaveProperty("record");
  });

  it("emits nothing for an insert rejected by the collection's field validation", async () => {
    collection.subscribe((event) => events.push(event));

    await expect(collection.insert({ price: 40 })).rejects.toThrow(RecordValidationError);
    expect(events).toEqual([]);
  });

  it("emits nothing when the adapter itself throws", async () => {
    collection.subscribe((event) => events.push(event));

    await expect(collection.update("missing", { price: 50 })).rejects.toThrow(
      RecordNotFoundError,
    );
    expect(events).toEqual([]);
  });

  it("delivers only this collection's events to a collection subscriber", async () => {
    const store = createStore(
      createCore({ collections: [services, others] }),
      createFakeAdapter(),
    );
    store.collection("services").subscribe((event) => events.push(event));

    await store.collection("others").insert({ name: "Ignored" });
    const record = await store.collection("services").insert({ name: "Haircut" });

    expect(events).toEqual([
      {
        scope: "collection",
        type: "create",
        collection: "services",
        id: record.id,
        record,
      },
    ]);
  });

  it("delivers only one record's updates and deletes to a record subscriber", async () => {
    const first = await collection.insert({ name: "Haircut", price: 40 });
    const recordEvents: RecordEvent[] = [];
    collection.subscribe(first.id, (event) => recordEvents.push(event));

    const second = await collection.insert({ name: "Massage", price: 80 });
    await collection.update(second.id, { price: 90 });
    await collection.update(first.id, { price: 50 });
    await collection.delete(first.id);

    expect(recordEvents.map((event) => event.type)).toEqual(["update", "delete"]);
    expect(recordEvents.every((event) => event.id === first.id)).toBe(true);
  });

  it("stops delivering once unsubscribed", async () => {
    const unsubscribe = collection.subscribe((event) => events.push(event));

    unsubscribe();
    await collection.insert({ name: "Haircut", price: 40 });

    expect(events).toEqual([]);
  });
});
