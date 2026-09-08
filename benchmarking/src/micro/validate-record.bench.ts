import { validateRecord, type RecordInput } from "@shuri/core";
import { bench, describe } from "vitest";
import { collections, samplePost } from "../sut/schema.ts";

/** `validateRecord` over the six-field `posts` record every insert pays for. */
const posts = collections[0];
const valid: RecordInput = { ...samplePost(1) };
const partial = { views: 2 };
const invalid = { ...valid, views: -1, category: "nope", contact: "not-an-email" };

describe("validateRecord, posts (6 fields)", () => {
  bench("valid record", () => {
    validateRecord(posts, valid);
  });
  bench("partial update (one field)", () => {
    validateRecord(posts, partial, { partial: true });
  });
  bench("record with three issues", () => {
    validateRecord(posts, invalid);
  });
});
