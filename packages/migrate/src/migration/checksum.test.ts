import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { add, col, int, text } from "../ops/test-support.js";
import { checksumOf } from "./checksum.js";
import { idAt, mig } from "./test-support.js";

const id = idAt(1, "add_price");
const base = mig(id, null, [add(col("posts"), "price", int)]);

describe("checksumOf", () => {
  it("is sha256 of the canonical JSON of format, id and ops", async () => {
    const canonical = `{"format":1,"id":"${id}","ops":[{"name":"price","op":"addField","spec":{"index":false,"kind":"integer","type":"number"},"target":{"kind":"collection","slug":"posts"}}]}`;
    const expected = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    expect(await checksumOf(base)).toBe(expected);
  });

  it("is stable across calls and well-formed", async () => {
    const first = await checksumOf(base);
    expect(await checksumOf({ ...base })).toBe(first);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("does not depend on parent, so a rebase keeps the recorded checksum", async () => {
    const rebased = { ...base, parent: idAt(0, "other") };
    expect(await checksumOf(rebased)).toBe(await checksumOf(base));
  });

  it("does not depend on object key order", async () => {
    const reordered = mig(id, null, [
      {
        target: { slug: "posts", kind: "collection" },
        spec: { type: "number", kind: "integer", index: false },
        name: "price",
        op: "addField",
      } as never,
    ]);
    expect(await checksumOf(reordered)).toBe(await checksumOf(base));
  });

  it("changes when an op changes (editing an applied migration is detectable)", async () => {
    const edited = mig(id, null, [add(col("posts"), "price", text)]);
    expect(await checksumOf(edited)).not.toBe(await checksumOf(base));
    const renamedField = mig(id, null, [add(col("posts"), "cost", int)]);
    expect(await checksumOf(renamedField)).not.toBe(await checksumOf(base));
  });

  it("changes when op order changes", async () => {
    const a = add(col("posts"), "a", text);
    const b = add(col("posts"), "b", text);
    expect(await checksumOf(mig(id, null, [a, b]))).not.toBe(
      await checksumOf(mig(id, null, [b, a])),
    );
  });

  it("changes when the id changes", async () => {
    expect(await checksumOf({ ...base, id: idAt(2, "add_price") })).not.toBe(
      await checksumOf(base),
    );
  });
});
