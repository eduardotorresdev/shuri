import { describe, expect, it } from "vitest";
import { ClientError } from "../errors.js";
import { createTestApp, credentials } from "./support.js";

describe("client.auth", () => {
  it("signs up, captures the session off Set-Cookie and sends it as a bearer from then on", async () => {
    const { client } = createTestApp({ auth: true });

    const { user } = await client.auth.signup(credentials);
    expect(user.email).toBe(credentials.email);
    expect(client.auth.getToken()).toBeTypeOf("string");

    const me = await client.auth.me();
    expect(me.user.id).toBe(user.id);

    // A write to a collection with no rule takes a signed-in principal: the bearer carries it.
    const post = await client.collections.posts.create({ title: "Hello" });
    expect(post.title).toBe("Hello");
  });

  it("logs out, forgetting the token, then logs back in", async () => {
    const { client } = createTestApp({ auth: true });
    await client.auth.signup(credentials);

    await client.auth.logout();
    expect(client.auth.getToken()).toBeUndefined();
    await expect(client.auth.me()).rejects.toMatchObject({ status: 401 });

    await client.auth.login(credentials);
    expect((await client.auth.me()).user.email).toBe(credentials.email);
  });

  it("reports a failed login as a ClientError", async () => {
    const { client } = createTestApp({ auth: true });
    await client.auth.signup(credentials);
    await client.auth.logout();

    const failed = client.auth.login({ ...credentials, password: "wrong-password-here" });
    await expect(failed).rejects.toBeInstanceOf(ClientError);
    await expect(failed).rejects.toMatchObject({ status: 401 });
    expect(client.auth.getToken()).toBeUndefined();
  });

  it("obtains a client-credentials token and uses it, capped by its scopes", async () => {
    const { app, client } = createTestApp({ auth: true });
    const issued = await app.auth.clients.create({ name: "Reader", roles: ["reader"] });

    const grant = await client.auth.token({
      clientId: issued.client.clientId,
      clientSecret: issued.clientSecret,
      scope: ["posts:list", "posts:create"],
    });

    expect(grant).toMatchObject({
      token_type: "Bearer",
      scope: "posts:list posts:create",
    });
    expect(client.auth.getToken()).toBe(grant.access_token);
    await client.collections.posts.create({ title: "By a machine" });
    // `site:update` was never granted, so the token is refused there.
    await expect(client.globals.site.update({ name: "x" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("maps an OAuth error body to the ClientError message", async () => {
    const { client } = createTestApp({ auth: true });

    await expect(
      client.auth.token({ clientId: "nope", clientSecret: "nope" }),
    ).rejects.toMatchObject({ status: 401, message: "invalid_client" });
  });

  it("builds the OIDC start URL, redirectTo included", () => {
    const { client } = createTestApp({ auth: true });

    expect(client.auth.oidcUrl("google")).toBe("http://localhost/auth/oidc/google");
    expect(client.auth.oidcUrl("google", { redirectTo: "/app" })).toBe(
      "http://localhost/auth/oidc/google?redirectTo=%2Fapp",
    );
  });
});
