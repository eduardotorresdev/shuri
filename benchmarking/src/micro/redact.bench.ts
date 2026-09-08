import { redactRecord, type CollectionSchema } from "@shuri/core";
import { bench, describe } from "vitest";
import { collections, samplePost } from "../sut/schema.ts";

/** `redactRecord` is applied to every record leaving over HTTP: free with no `hidden` field, a copy with one. */
const plain = collections[0];
const withHidden: CollectionSchema = {
  ...plain,
  fields: [...plain.fields, { type: "text", name: "secret", hidden: true }],
};
const record = { ...samplePost(3), id: "abc", secret: "s3cr3t" };

describe("redactRecord", () => {
  bench("no hidden field (returns the record)", () => {
    redactRecord(plain, record);
  });
  bench("one hidden field (copies 7 keys)", () => {
    redactRecord(withHidden, record);
  });
});
