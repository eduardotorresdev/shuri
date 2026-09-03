import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "./bus.js";
import type { StoreEvent } from "./types.js";

const created: StoreEvent = {
  scope: "collection",
  type: "create",
  collection: "services",
  id: "1",
  record: { id: "1", name: "Haircut" },
};

describe("createEventBus", () => {
  it("delivers every emitted event to every subscriber", () => {
    const bus = createEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe(first);
    bus.subscribe(second);

    bus.emit(created);

    expect(first).toHaveBeenCalledWith(created);
    expect(second).toHaveBeenCalledWith(created);
  });

  it("stops delivering once unsubscribed, and unsubscribing twice is harmless", () => {
    const bus = createEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);

    unsubscribe();
    unsubscribe();
    bus.emit(created);

    expect(listener).not.toHaveBeenCalled();
  });

  it("still delivers to the remaining listeners when one unsubscribes mid-dispatch", () => {
    const bus = createEventBus();
    const last = vi.fn();
    const unsubscribeSelf = bus.subscribe(() => unsubscribeSelf());
    bus.subscribe(last);

    bus.emit(created);

    expect(last).toHaveBeenCalledWith(created);
  });

  it("keeps delivering to the other listeners when one throws, and rethrows it out of band", () => {
    const bus = createEventBus();
    const deferred: (() => void)[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((task) => {
      deferred.push(task);
    });
    const boom = new Error("listener boom");
    const other = vi.fn();
    bus.subscribe(() => {
      throw boom;
    });
    bus.subscribe(other);

    expect(() => bus.emit(created)).not.toThrow();
    expect(other).toHaveBeenCalledWith(created);
    expect(deferred).toHaveLength(1);
    expect(() => deferred[0]?.()).toThrow(boom);

    vi.restoreAllMocks();
  });
});
