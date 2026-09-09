import { describe, expect, it } from "vitest";
import { toAdminSession, toSessionResolver, type BetterAuthSession } from "./session.js";

const resolved: BetterAuthSession = {
  session: { id: "s1", expiresAt: new Date("2026-12-01T00:00:00.000Z") },
  user: {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    role: "editor",
  },
};

describe("toAdminSession", () => {
  it("reshapes better-auth's session into the one the admin speaks", () => {
    const session = toAdminSession(resolved);

    expect(session.id).toBe("s1");
    expect(session.user.email).toBe("ada@example.com");
    expect(session.user.name).toBe("Ada");
    expect(session.expiresAt).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
  });

  it("reads a serialized date as well as a Date, since the store holds strings", () => {
    const session = toAdminSession({
      ...resolved,
      session: { id: "s1", expiresAt: "2026-12-01T00:00:00.000Z" },
    });

    expect(session.expiresAt).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
  });

  it("keeps the host's own user columns, which is what `authorize` reads", () => {
    expect(toAdminSession(resolved).user["role"]).toBe("editor");
  });

  it("leaves `name` off rather than carrying a null through", () => {
    const session = toAdminSession({
      ...resolved,
      user: { id: "u1", email: "a@b.com", name: null },
    });

    expect(session.user.name).toBeUndefined();
    expect("name" in session.user).toBe(false);
  });
});

describe("toSessionResolver", () => {
  it("passes the request's headers to better-auth and reshapes what comes back", async () => {
    let seen: Headers | undefined;
    const getSession = toSessionResolver({
      api: {
        async getSession({ headers }) {
          seen = headers;
          return resolved;
        },
      },
    });

    const session = await getSession(
      new Request("http://x/collections/posts", { headers: { cookie: "a=b" } }),
    );

    expect(seen?.get("cookie")).toBe("a=b");
    expect(session?.user.email).toBe("ada@example.com");
  });

  it("reports no session rather than null, which is what AdminSessionSource expects", async () => {
    const getSession = toSessionResolver({ api: { getSession: async () => null } });

    expect(await getSession(new Request("http://x/"))).toBeUndefined();
  });
});
