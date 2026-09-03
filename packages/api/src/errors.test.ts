import { describe, expect, it } from "vitest";
import { ApiError, InvalidJsonBodyError, MethodNotAllowedError } from "./errors.js";

describe("ApiError subclasses", () => {
  it("carries the expected status and message", () => {
    expect(new MethodNotAllowedError("PUT")).toMatchObject({
      status: 405,
      message: 'Method "PUT" not allowed',
    });
    expect(new InvalidJsonBodyError()).toMatchObject({
      status: 400,
      message: "Invalid JSON body",
    });
  });

  it("is an instance of ApiError and Error", () => {
    const error = new InvalidJsonBodyError();
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
  });
});
