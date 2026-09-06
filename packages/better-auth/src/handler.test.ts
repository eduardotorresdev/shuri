import { describe, expect, it } from "vitest";
import { toFallingHandler } from "./handler.js";

const auth = {
  handler: async (request: Request) =>
    new Response(new URL(request.url).pathname, { status: 200 }),
};
const handler = toFallingHandler(auth, "/api/auth");

describe("toFallingHandler", () => {
  it("answers better-auth's own routes", async () => {
    const response = await handler(new Request("http://x/api/auth/sign-in/email"));

    expect(await response?.text()).toBe("/api/auth/sign-in/email");
  });

  it("answers the base path itself", async () => {
    expect(await handler(new Request("http://x/api/auth"))).toBeDefined();
  });

  it("declines everything else, instead of 404ing the whole app", async () => {
    expect(await handler(new Request("http://x/collections/posts"))).toBeUndefined();
    expect(await handler(new Request("http://x/"))).toBeUndefined();
  });

  it("does not treat a path that merely starts the same way as its own", async () => {
    expect(await handler(new Request("http://x/api/authentication"))).toBeUndefined();
  });

  it("follows a relocated base path", async () => {
    const moved = toFallingHandler(auth, "/auth");

    expect(await moved(new Request("http://x/auth/sign-out"))).toBeDefined();
    expect(await moved(new Request("http://x/api/auth/sign-out"))).toBeUndefined();
  });
});
