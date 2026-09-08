import { matchesWhere } from "@shuri/store";
import { bench, describe } from "vitest";
import { samplePost } from "../sut/schema.ts";

/** `matchesWhere` per record: what a filtered `findMany` on the memory adapter pays per row, and what an access rule's `Where` costs per record. */
const record = { ...samplePost(3), id: "abc" };

describe("matchesWhere, one record", () => {
  bench("eq", () => {
    matchesWhere(record, { published: { op: "eq", value: true } });
  });
  bench("contains", () => {
    matchesWhere(record, { title: { op: "contains", value: "#3" } });
  });
  bench("in", () => {
    matchesWhere(record, { category: { op: "in", value: ["news", "guide"] } });
  });
  bench("array of filters on one field + two more fields", () => {
    matchesWhere(record, {
      views: [
        { op: "gte", value: 0 },
        { op: "lt", value: 1000 },
      ],
      published: { op: "ne", value: false },
      category: { op: "eq", value: "news" },
    });
  });
});
