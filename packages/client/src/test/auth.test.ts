import { describe, expect, it } from "vitest";
import { createClient } from "../create.js";
import { ClientError } from "../errors.js";
import { createTestApp, credentials } from "./support.js";

describe("client.auth", () => {
  it("signs up, captures the session cookie and sends it back from then on", async () => {
    const { client } = createTestApp({ auth: true });

    const { user } = await client.auth.signup(credentials);
    expect(user.email).toBe(credentials.email);
    // No bearer is involved: the jar holds better-auth's cookie, as a browser would.
    expect(client.auth.getToken()).toBeUndefined();

    const me = await client.auth.me();
    expect(me.user.id).toBe(user.id);

    // A write to a collection with no rule takes a signed-in principal: the cookie carries it.
    const post = await client.collections.posts.create({ title: "Hello" });
    expect(post.title).toBe("Hello");
  });

  it("logs out, forgetting the cookie, then logs back in", async () => {
    const { client } = createTestApp({ auth: true });
    await client.auth.signup(credentials);

    await client.auth.logout();
    await expect(client.auth.me()).rejects.toMatchObject({ status: 401 });
    await expect(client.collections.posts.create({ title: "x" })).rejects.toMatchObject({
      status: 401,
    });

    await client.auth.login(credentials);
    expect((await client.auth.me()).user.email).toBe(credentials.email);
  });

  it("reports a failed login as a ClientError carrying better-auth's message", async () => {
    const { client } = createTestApp({ auth: true });
    await client.auth.signup(credentials);
    await client.auth.logout();

    const failed = client.auth.login({ ...credentials, password: "wrong-password-here" });
    await expect(failed).rejects.toBeInstanceOf(ClientError);
    await expect(failed).rejects.toMatchObject({ status: 401 });
    await expect(failed).rejects.toThrow(/invalid/i);
  });

  it("names the address on signup when none was given, since better-auth requires one", async () => {
    const { client } = createTestApp({ auth: true });

    const { user } = await client.auth.signup(credentials);

    expect(user.name).toBe(credentials.email);
  });

  it("sends a bearer once given one, for a host running better-auth's bearer plugin", async () => {
    const { client } = createTestApp({ auth: true, client: { token: "abc" } });

    expect(client.auth.getToken()).toBe("abc");
    client.auth.clearToken();
    expect(client.auth.getToken()).toBeUndefined();
  });
});

describe("client.auth as a machine", () => {
  it("acts as the client behind an API key set as the bearer, within its scopes", async () => {
    const { app, client, auth } = createTestApp({ auth: true });
    if (!auth) throw new Error("auth: true hands the plugin back");
    const { user } = await client.auth.signup(credentials);
    const issued = await auth.apiKeys.create({
      name: "ci",
      userId: user.id,
      permissions: { posts: ["list", "create"] },
    });

    // A second client, holding the key and nothing else: no cookie, no signup, no session.
    const bot = createClient<typeof app.schema>({
      baseUrl: "http://localhost",
      fetch: (input, init) => app.handler(new Request(input, init)),
      token: issued.key,
    });

    expect((await bot.collections.posts.create({ title: "By bot" })).title).toBe(
      "By bot",
    );
    expect((await bot.collections.posts.list()).map((post) => post.title)).toEqual([
      "By bot",
    ]);
    // Not in its permissions: refused as a known client, not as nobody.
    await expect(bot.globals.site.get()).rejects.toMatchObject({ status: 403 });
    // A key is not a session: `me()` has nothing to answer with.
    await expect(bot.auth.me()).rejects.toMatchObject({ status: 401 });
  });
});
