import { UnknownCollectionError } from "@shuri/store";
import { describe, expect, it } from "vitest";
import { createFakeApp, createFakeCollectionStore } from "../collections/test-support.js";
import { servableCollection } from "./internal.js";
import { accountsSchema, sessionsSchema } from "./test-support.js";

function app() {
  return createFakeApp(
    createFakeCollectionStore(accountsSchema),
    createFakeCollectionStore(sessionsSchema),
  );
}

describe("servableCollection", () => {
  it("resolves a collection HTTP is allowed to serve", () => {
    expect(servableCollection(app().store, "accounts").schema).toBe(accountsSchema);
  });

  it("throws the store's own UnknownCollectionError for an internal collection", () => {
    expect(() => servableCollection(app().store, "_sessions")).toThrow(
      UnknownCollectionError,
    );
  });

  it("makes an internal collection indistinguishable from one never declared", () => {
    const store = app().store;
    const internal = catchError(() => servableCollection(store, "_sessions"));
    const unknown = catchError(() => servableCollection(store, "nope"));

    expect(internal).toBeInstanceOf(UnknownCollectionError);
    expect(unknown).toBeInstanceOf(UnknownCollectionError);
    expect((internal as Error).message).toBe('Unknown collection "_sessions"');
    expect((unknown as Error).message).toBe('Unknown collection "nope"');
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}
