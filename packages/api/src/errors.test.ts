import { describe, expect, it } from "vitest";
import { ApiError, InvalidJsonBodyError, InvalidQueryError, MethodNotAllowedError, UnknownRouteError } from "./errors.js";

describe("ApiError subclasses", () => {
  it("carries the expected status and message", () => {
    expect(new UnknownRouteError()).toMatchObject({ status: 404, message: "Not found" });
    expect(new MethodNotAllowedError("PUT")).toMatchObject({ status: 405, message: 'Method "PUT" not allowed' });
    expect(new InvalidJsonBodyError()).toMatchObject({ status: 400, message: "Invalid JSON body" });
  });

  it("is an instance of ApiError and Error", () => {
    const error = new InvalidJsonBodyError();
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("InvalidQueryError", () => {
  it("formats its message from the issues and keeps them accessible", () => {
    const error = new InvalidQueryError([{ path: "query.limit", message: '"limit" must be a non-negative integer' }]);
    expect(error.status).toBe(400);
    expect(error.message).toBe('query.limit: "limit" must be a non-negative integer');
    expect(error.issues).toEqual([{ path: "query.limit", message: '"limit" must be a non-negative integer' }]);
  });
});
