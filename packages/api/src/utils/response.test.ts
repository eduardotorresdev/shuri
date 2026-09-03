import {
  RecordNotFoundError,
  RecordValidationError,
  UnknownCollectionError,
} from "@shuri/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnknownRouteError } from "../collections/errors.js";
import {
  errorResponse,
  eventStreamResponse,
  jsonResponse,
  noContentResponse,
  toErrorResponse,
} from "./response.js";

const decoder = new TextDecoder();

/**
 * Reads a streaming response's body, failing loudly if it has none.
 * @param response - The streaming response to read.
 * @returns A reader over the response body.
 */
function bodyReader(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) throw new Error("expected a streaming body");
  return response.body.getReader();
}

/**
 * Reads the next chunk written to `response`'s body, as text.
 * @param reader - The reader over the response body.
 * @returns The decoded chunk, or `undefined` once the stream is closed.
 */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string | undefined> {
  const { value, done } = await reader.read();
  return done ? undefined : decoder.decode(value);
}

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

describe("eventStreamResponse", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("responds with the streaming headers", () => {
    const response = eventStreamResponse(() => () => {}, { heartbeatMs: 0 });

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("delivers the frames sent by start to the reader", async () => {
    const response = eventStreamResponse(
      (send) => {
        send("event: create\ndata: {}\n\n");
        send("event: delete\ndata: {}\n\n");
        return () => {};
      },
      { heartbeatMs: 0 },
    );
    const reader = bodyReader(response);

    expect(await readChunk(reader)).toBe("event: create\ndata: {}\n\n");
    expect(await readChunk(reader)).toBe("event: delete\ndata: {}\n\n");
    await reader.cancel();
  });

  it("runs the teardown when the reader cancels the stream", async () => {
    const teardown = vi.fn();
    const response = eventStreamResponse(() => teardown, { heartbeatMs: 0 });

    await bodyReader(response).cancel();

    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("closes the stream and runs the teardown exactly once when the signal aborts", async () => {
    const controller = new AbortController();
    const teardown = vi.fn();
    const response = eventStreamResponse(() => teardown, {
      signal: controller.signal,
      heartbeatMs: 0,
    });
    const reader = bodyReader(response);

    controller.abort();

    expect(await readChunk(reader)).toBeUndefined();
    await reader.cancel();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("writes a keep-alive comment every heartbeatMs", async () => {
    vi.useFakeTimers();
    const response = eventStreamResponse(() => () => {}, { heartbeatMs: 1000 });
    const reader = bodyReader(response);

    vi.advanceTimersByTime(1000);

    expect(await readChunk(reader)).toBe(": keep-alive\n\n");
    await reader.cancel();
  });
});
