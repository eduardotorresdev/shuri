import { describe, expect, it } from "vitest";
import { resolveAdminAuth } from "./access.js";
import { createAdminGuard } from "./guard.js";
import { asUser, stubSessions } from "./test-support.js";

const api = { collections: "/collections", globals: "/globals", events: "/events" };
const sessions = stubSessions({ ada: { role: "editor" }, bob: { role: "reader" } });

const guard = createAdminGuard(resolveAdminAuth({ auth: sessions }, api));

const write = (token?: string, path = "/collections/posts") =>
  asUser(token, new Request(`http://x${path}`, { method: "POST" }));

describe("createAdminGuard", () => {
  it("refuses an anonymous write with 401", async () => {
    const response = await guard(write());

    expect(response?.status).toBe(401);
  });

  it("lets an authorized write through to the routes that serve it", async () => {
    expect(await guard(write("ada"))).toBeUndefined();
  });

  it("answers 403, not 401, for a session the host refuses", async () => {
    const strict = createAdminGuard(
      resolveAdminAuth(
        { auth: sessions, authorize: (s) => s.user["role"] === "editor" },
        api,
      ),
    );

    expect((await strict(write("bob")))?.status).toBe(403);
    expect(await strict(write("ada"))).toBeUndefined();
  });

  it("declines a read, so the API stays publicly readable", async () => {
    expect(await guard(new Request("http://x/collections/posts"))).toBeUndefined();
  });

  it("declines the login route, or signing in would need a session", async () => {
    expect(
      await guard(new Request("http://x/auth/login", { method: "POST" })),
    ).toBeUndefined();
  });

  it("declines the admin's own paths, so the login screen is reachable", async () => {
    expect(await guard(new Request("http://x/admin"))).toBeUndefined();
    expect(await guard(new Request("http://x/admin/schema.json"))).toBeUndefined();
  });

  it("says why it refused, in the body the admin already knows how to read", async () => {
    const response = await guard(write());

    expect(await response?.json()).toEqual({ error: "Not authenticated" });
  });

  it("closes reads too when the host asks for it", async () => {
    const closed = createAdminGuard(
      resolveAdminAuth({ auth: sessions, protect: () => true }, api),
    );

    expect((await closed(new Request("http://x/collections/posts")))?.status).toBe(401);
  });
});
