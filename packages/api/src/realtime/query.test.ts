import { describe, expect, it } from "vitest";
import { InvalidEventQueryError } from "./errors.js";
import { parseEventQuery } from "./query.js";

function parse(query: string): ReturnType<typeof parseEventQuery> {
  return parseEventQuery(new URLSearchParams(query));
}

describe("parseEventQuery", () => {
  it("selects nothing when no param is given", () => {
    expect(parse("")).toEqual({
      collection: undefined,
      global: undefined,
      id: undefined,
      events: undefined,
    });
  });

  it("reads every selector", () => {
    expect(parse("collection=posts&global=site&id=abc&events=create")).toMatchObject({
      collection: ["posts"],
      global: ["site"],
      id: ["abc"],
      events: ["create"],
    });
  });

  it("accepts both repeated params and comma-separated values", () => {
    expect(parse("collection=posts&collection=authors")).toMatchObject({
      collection: ["posts", "authors"],
    });
    expect(parse("collection=posts,authors")).toMatchObject({
      collection: ["posts", "authors"],
    });
    expect(parse("events=create,update")).toMatchObject({
      events: ["create", "update"],
    });
  });

  it("rejects an unknown event name, pointing at its index", () => {
    expect(() => parse("events=nope")).toThrow(InvalidEventQueryError);
    try {
      parse("events=create,nope");
    } catch (error) {
      expect((error as InvalidEventQueryError).issues).toEqual([
        {
          path: "query.events.1",
          message: '"events" must be one of create, update, delete',
        },
      ]);
    }
  });

  it("rejects an empty entry instead of dropping it", () => {
    try {
      parse("events=create,");
    } catch (error) {
      expect((error as InvalidEventQueryError).issues).toMatchObject([
        { path: "query.events.1" },
      ]);
    }
    expect(() => parse("collection=")).toThrow(InvalidEventQueryError);
  });
});
