import { describe, expect, it } from "vitest";
import { resolveAdminAuth, toViewer } from "./access.js";
import { asUser, stubSessions } from "./test-support.js";

const api = { collections: "/collections", globals: "/globals", events: "/events" };
const auth = stubSessions({
  ada: { id: "u1", email: "ada@example.com", name: "Ada", role: "editor" },
  bob: { id: "u2", email: "bob@example.com", role: "reader" },
});

const get = (token?: string) => asUser(token, new Request("http://x/collections/posts"));

describe("resolveAdminAuth", () => {
  it("advertises the auth defaults", async () => {
    expect(await resolveAdminAuth({ auth }, api).advertised()).toEqual({
      basePath: "/auth",
      signIn: "/auth/login",
      signOut: "/auth/logout",
      providers: [],
    });
  });

  it("advertises what the host declared instead", async () => {
    const resolved = resolveAdminAuth(
      { auth, basePath: "/session", providers: ["google"] },
      api,
    );

    expect(await resolved.advertised()).toEqual({
      basePath: "/session",
      signIn: "/session/login",
      signOut: "/session/logout",
      providers: ["google"],
    });
  });

  it("reports no session as anonymous", async () => {
    expect(await resolveAdminAuth({ auth }, api).resolve(get())).toEqual({
      status: "anonymous",
    });
  });

  it("accepts any session by default", async () => {
    const access = await resolveAdminAuth({ auth }, api).resolve(get("bob"));

    expect(access.status).toBe("allowed");
  });

  it("separates authenticated from allowed, so the host can decide who edits", async () => {
    const resolved = resolveAdminAuth(
      { auth, authorize: (session) => session.user["role"] === "editor" },
      api,
    );

    expect((await resolved.resolve(get("ada"))).status).toBe("allowed");
    expect((await resolved.resolve(get("bob"))).status).toBe("forbidden");
    expect((await resolved.resolve(get())).status).toBe("anonymous");
  });

  it("awaits an async authorize, so it can ask the store", async () => {
    const resolved = resolveAdminAuth({ auth, authorize: async () => false }, api);

    expect((await resolved.resolve(get("ada"))).status).toBe("forbidden");
  });

  it("protects writes to the REST routes by default", () => {
    const { protect } = resolveAdminAuth({ auth }, api);

    expect(protect(new Request("http://x/collections/posts", { method: "POST" }))).toBe(
      true,
    );
    expect(protect(new Request("http://x/collections/posts"))).toBe(false);
  });

  it("uses the host's own predicate when given one", () => {
    const { protect } = resolveAdminAuth({ auth, protect: () => true }, api);

    expect(protect(new Request("http://x/anything"))).toBe(true);
  });
});

describe("toViewer", () => {
  it("projects the user down to what the admin shows", async () => {
    const access = await resolveAdminAuth({ auth }, api).resolve(get("ada"));

    expect(toViewer(access)).toEqual({
      status: "allowed",
      user: { id: "u1", email: "ada@example.com", name: "Ada" },
    });
  });

  it("carries the user through for a forbidden viewer, so the screen can name them", async () => {
    const resolved = resolveAdminAuth({ auth, authorize: () => false }, api);

    expect(toViewer(await resolved.resolve(get("bob")))).toEqual({
      status: "forbidden",
      user: { id: "u2", email: "bob@example.com" },
    });
  });

  it("names nobody when there is no session", async () => {
    const access = await resolveAdminAuth({ auth }, api).resolve(get());

    expect(toViewer(access)).toEqual({ status: "anonymous" });
  });
});

describe("resolveAdminAuth credential paths", () => {
  it("advertises a different auth implementation's own routes", async () => {
    const resolved = resolveAdminAuth(
      {
        auth,
        basePath: "/api/auth",
        signInPath: "/api/auth/sign-in/email",
        signOutPath: "/api/auth/sign-out",
      },
      api,
    );

    expect(await resolved.advertised()).toEqual({
      basePath: "/api/auth",
      signIn: "/api/auth/sign-in/email",
      signOut: "/api/auth/sign-out",
      providers: [],
    });
  });
});
