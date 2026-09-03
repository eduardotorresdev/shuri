import {
  RecordNotFoundError,
  RecordValidationError,
  UnknownCollectionError,
} from "@shuri/store";
import { describe, expect, it } from "vitest";
import { UnknownRouteError } from "../collections/errors.js";
import {
  errorResponse,
  jsonResponse,
  noContentResponse,
  toErrorResponse,
} from "./response.js";

describe("jsonResponse", () => {
  it("serializes the body as JSON with a content-type header", async () => {
    const response = jsonResponse({ name: "Haircut" });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ name: "Haircut" });
    expect(response.status).toBe(200);
  });

  it("honors a custom status", () => {
    expect(jsonResponse({}, { status: 201 }).status).toBe(201);
  });
});

describe("errorResponse", () => {
  it("wraps the message in an error object with the given status", async () => {
    const response = errorResponse(404, "Not found");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("merges extra details into the body", async () => {
    const response = errorResponse(400, "Invalid record", {
      issues: [{ path: "name", message: "required" }],
    });
    expect(await response.json()).toEqual({
      error: "Invalid record",
      issues: [{ path: "name", message: "required" }],
    });
  });
});

describe("noContentResponse", () => {
  it("returns an empty 204 response", async () => {
    const response = noContentResponse();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});

describe("toErrorResponse", () => {
  it("maps an ApiError to a response using its own status", async () => {
    const response = toErrorResponse(new UnknownRouteError());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("maps an UnknownCollectionError to a 404", async () => {
    const response = toErrorResponse(new UnknownCollectionError("services"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Unknown collection "services"',
    });
  });

  it("maps a RecordNotFoundError to a 404", async () => {
    const response = toErrorResponse(new RecordNotFoundError("services", "abc"));
    expect(response.status).toBe(404);
  });

  it("maps a RecordValidationError to a 400 carrying its issues", async () => {
    const error = new RecordValidationError("services", [
      { path: "record.name", message: '"name" is required' },
    ]);
    const response = toErrorResponse(error);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: error.message,
      issues: [{ path: "record.name", message: '"name" is required' }],
    });
  });

  it("rethrows errors it doesn't recognize", () => {
    const error = new Error("boom");
    expect(() => toErrorResponse(error)).toThrow(error);
  });
});
