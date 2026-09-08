import { beforeEach, describe, expect, it } from "vitest";
import { createAuth, type AuthApi } from "../create.js";
import { createAuthStore, createTestHasher } from "../test-support.js";

/** Every way a request identifies itself, resolved to the principal `@shuri/api`'s guards see. */
let auth: AuthApi;

beforeEach(() => {
  auth = createAuth({
    store: createAuthStore(),
    hasher: createTestHasher(),
    scopes: ["posts:list"],
    clients: { roles: { reader: ["posts:list"] } },
  });
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/collections/posts", { headers });
}

describe("auth.principal", () => {
  it("is anonymous with nothing, or with a credential that doesn't resolve", async () => {
    expect(await auth.principal(request())).toEqual({ kind: "anonymous" });
    expect(await auth.principal(request({ cookie: "shuri_session=nope" }))).toEqual({
      kind: "anonymous",
    });
    expect(await auth.principal(request({ authorization: "Bearer sct_nope" }))).toEqual({
      kind: "anonymous",
    });
  });

  it("is the user behind a session cookie or bearer", async () => {
    const { token, user } = await auth.signUp({
      email: "ada@example.com",
      password: "correct-horse",
    });
    expect(await auth.principal(request({ cookie: `shuri_session=${token}` }))).toEqual({
      kind: "user",
      user,
    });
    expect(await auth.principal(request({ authorization: `Bearer ${token}` }))).toEqual({
      kind: "user",
      user,
    });
  });

  it("is the client behind an sct_ bearer, with the token's scopes", async () => {
    const { client } = await auth.clients.create({ name: "bot", roles: ["reader"] });
    const { token } = await auth.issueClientToken(client.clientId);
    expect(await auth.principal(request({ authorization: `Bearer ${token}` }))).toEqual({
      kind: "client",
      client: { id: client.id, name: "bot", clientId: client.clientId },
      scopes: new Set(["posts:list"]),
    });
  });
});
