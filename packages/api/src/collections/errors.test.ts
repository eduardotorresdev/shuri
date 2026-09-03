import { describe, expect, it } from "vitest";
import { InvalidQueryError, UnknownRouteError } from "./errors.js";

describe("UnknownRouteError", () => {
  it("carries the expected status and message", () => {
    expect(new UnknownRouteError()).toMatchObject({
      status: 404,
      message: "Not found",
    });
  });
});

describe("InvalidQueryError", () => {
  it("formats its message from the issues and keeps them accessible", () => {
    const error = new InvalidQueryError([
      {
        path: "query.limit",
        message: '"limit" must be a non-negative integer',
      },
    ]);
    expect(error.status).toBe(400);
    expect(error.message).toBe('query.limit: "limit" must be a non-negative integer');
    expect(error.issues).toEqual([
      {
        path: "query.limit",
        message: '"limit" must be a non-negative integer',
      },
    ]);
  });
});
