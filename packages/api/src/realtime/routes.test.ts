import { describe, expect, it } from "vitest";
import { matchRealtimeRoute } from "./routes.js";

describe("matchRealtimeRoute", () => {
  it("matches the base path exactly", () => {
    expect(matchRealtimeRoute("/events", "/events")).toBe(true);
  });

  it("tolerates a trailing slash", () => {
    expect(matchRealtimeRoute("/events/", "/events")).toBe(true);
  });

  it("rejects anything below or beside the base path", () => {
    expect(matchRealtimeRoute("/events/posts", "/events")).toBe(false);
    expect(matchRealtimeRoute("/eventsource", "/events")).toBe(false);
    expect(matchRealtimeRoute("/collections/posts", "/events")).toBe(false);
  });

  it("honors a custom base path", () => {
    expect(matchRealtimeRoute("/stream", "/stream")).toBe(true);
    expect(matchRealtimeRoute("/events", "/stream")).toBe(false);
  });
});
