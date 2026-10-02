import { describe, expect, it } from "vitest";
import {
  alter,
  col,
  glob,
  int,
  renameEntity,
  text,
  textarea,
} from "../ops/test-support.js";
import { applyOpToData, emptyFakeData, type FakeData } from "./fake-data.js";

const posts = col("posts");
const withPosts = (rows: Record<string, unknown>[]): FakeData => {
  const data = emptyFakeData();
  data.collections.posts = rows.map((row, i) => ({ ...row, id: String(i) }));
  return data;
};

describe("applyOpToData", () => {
  it("renameField is idempotent: a second run, or a row that already has the new name, changes nothing", () => {
    const data = withPosts([{ title: "a" }, { name: "kept", title: "x" }]);
    const op = { op: "renameField", target: posts, from: "title", to: "name" } as const;
    applyOpToData(data, op);
    applyOpToData(data, op);
    expect(data.collections.posts).toEqual([
      { id: "0", name: "a" },
      { id: "1", name: "kept", title: "x" },
    ]);
  });

  it("alterField converts present values only and removes the key when the value cannot convert", () => {
    const data = withPosts([{ n: "5" }, { n: "five" }, {}]);
    const op = alter(posts, "n", text, { type: "number", kind: "integer", index: false });
    applyOpToData(data, op);
    applyOpToData(data, op);
    expect(data.collections.posts).toEqual([{ id: "0", n: 5 }, { id: "1" }, { id: "2" }]);
  });

  it("alterField leaves lossless text conversions intact", () => {
    const data = withPosts([{ t: "keep" }]);
    applyOpToData(data, alter(posts, "t", text, textarea));
    expect(data.collections.posts).toEqual([{ id: "0", t: "keep" }]);
    expect(int.type).toBe("number");
  });

  it("renameEntity moves the rows, ignores a missing source and refuses to overwrite data", () => {
    const data = withPosts([{ a: 1 }]);
    applyOpToData(data, renameEntity(posts, "articles"));
    applyOpToData(data, renameEntity(posts, "articles"));
    expect(data.collections).toEqual({ articles: [{ id: "0", a: 1 }] });

    data.collections.posts = [{ id: "9" }];
    expect(() => applyOpToData(data, renameEntity(posts, "articles"))).toThrow(
      /has data/,
    );
  });

  it("renameEntity moves a global's document", () => {
    const data = emptyFakeData();
    data.globals.site = { name: "x" };
    applyOpToData(data, renameEntity(glob("site"), "settings"));
    expect(data.globals).toEqual({ settings: { name: "x" } });
  });

  it("dropEntity and createEntity act on rows, never on a global's absent document", () => {
    const data = withPosts([{ a: 1 }]);
    applyOpToData(data, { op: "dropEntity", target: posts });
    expect(data.collections).toEqual({});
    applyOpToData(data, { op: "createEntity", target: posts, fields: {} });
    expect(data.collections).toEqual({ posts: [] });
    applyOpToData(data, { op: "createEntity", target: glob("site"), fields: {} });
    expect(data.globals).toEqual({});
  });
});
