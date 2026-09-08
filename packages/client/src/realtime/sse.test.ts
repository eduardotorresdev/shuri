import { describe, expect, it } from "vitest";
import { parseEventStream, parseMessage } from "./sse.js";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("parseMessage", () => {
  it("reads the event name and joins data lines", () => {
    expect(parseMessage('event: create\ndata: {"a":\ndata: 1}')).toEqual({
      event: "create",
      data: '{"a":\n1}',
    });
  });

  it("defaults the event name and tolerates a missing space after the colon", () => {
    expect(parseMessage("data:x")).toEqual({ event: "message", data: "x" });
  });

  it("ignores comments and unknown fields, and yields nothing without data", () => {
    expect(parseMessage(": keep-alive")).toBeUndefined();
    expect(parseMessage("id: 1\nretry: 100")).toBeUndefined();
    expect(parseMessage(": c\nevent: update\nid: 7\ndata: 1")).toEqual({
      event: "update",
      data: "1",
    });
  });
});

describe("parseEventStream", () => {
  it("reassembles messages split across chunks, CRLF included, and flushes a trailing one", async () => {
    const messages: unknown[] = [];
    await parseEventStream(
      streamOf(
        "event: cre",
        "ate\r\ndata: 1\r\n\r\n: keep-alive\n\nevent: delete\ndata: 2",
      ),
      (message) => messages.push(message),
    );
    expect(messages).toEqual([
      { event: "create", data: "1" },
      { event: "delete", data: "2" },
    ]);
  });
});
