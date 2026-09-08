import { describe, expect, it, vi } from "vitest";
import { runAfterHooks, runBeforeHooks } from "./run.js";

interface Args {
  data: { title: string; views?: number };
  id?: string;
}

describe("runBeforeHooks", () => {
  it("threads each hook's replacement into the next, and returns the final value", async () => {
    const seen: string[] = [];
    const result = await runBeforeHooks<Args, "data">(
      [
        ({ data }) => {
          seen.push(data.title);
          return { ...data, title: data.title.trim() };
        },
        ({ data }) => {
          seen.push(data.title);
          return { ...data, views: 0 };
        },
      ],
      { data: { title: " Hello " } },
      "data",
    );

    expect(seen).toEqual([" Hello ", "Hello"]);
    expect(result).toEqual({ title: "Hello", views: 0 });
  });

  it("keeps the current value when a hook returns nothing, sync or async", async () => {
    const result = await runBeforeHooks<Args, "data">(
      [() => {}, async () => {}],
      { data: { title: "Hello" } },
      "data",
    );
    expect(result).toEqual({ title: "Hello" });
  });

  it("awaits hooks one at a time, in order", async () => {
    const order: number[] = [];
    await runBeforeHooks<Args, "data">(
      [
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push(1);
        },
        () => {
          order.push(2);
        },
      ],
      { data: { title: "Hello" } },
      "data",
    );
    expect(order).toEqual([1, 2]);
  });

  it("aborts the chain when a hook throws, leaving the hooks after it unrun", async () => {
    const later = vi.fn();
    await expect(
      runBeforeHooks<Args, "data">(
        [
          () => {
            throw new Error("nope");
          },
          later,
        ],
        { data: { title: "Hello" } },
        "data",
      ),
    ).rejects.toThrow("nope");
    expect(later).not.toHaveBeenCalled();
  });
});

describe("runAfterHooks", () => {
  it("runs every hook with the same args, in order", async () => {
    const calls: string[] = [];
    await runAfterHooks<Args>(
      [
        async ({ data }) => {
          calls.push(`a:${data.title}`);
        },
        ({ data }) => {
          calls.push(`b:${data.title}`);
        },
      ],
      { data: { title: "Hello" } },
    );
    expect(calls).toEqual(["a:Hello", "b:Hello"]);
  });

  it("propagates a throwing hook to the caller", async () => {
    await expect(
      runAfterHooks<Args>(
        [
          () => {
            throw new Error("listener failed");
          },
        ],
        { data: { title: "Hello" } },
      ),
    ).rejects.toThrow("listener failed");
  });
});
