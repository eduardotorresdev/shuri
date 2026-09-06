import { describe, expect, it, vi } from "vitest";
import { createAdminSetupHandler, resolveAdminSetup } from "./setup.js";
import type { AdminSetupSource } from "./setup-types.js";

const VALID = { email: "ada@example.com", password: "correct horse battery" };

/**
 * A setup source over a mutable "account exists" flag, so a test drives the first-run window by
 * hand rather than through a real auth implementation.
 * @param [delayMs] - Milliseconds `create` takes, for exercising the lock.
 * @returns The source, plus the accounts it created.
 */
function stubSource(delayMs = 0) {
  const created: string[] = [];
  const source: AdminSetupSource = {
    async required() {
      return created.length === 0;
    },
    async create(credentials) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      created.push(credentials.email);
      return new Response(null, { status: 200, headers: { "set-cookie": "session=1" } });
    },
  };
  return { source, created };
}

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request("http://x/admin/setup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("resolveAdminSetup", () => {
  it("hangs the default path off the admin's own base path", () => {
    const { source } = stubSource();

    expect(resolveAdminSetup({ source }, "/admin").advertised).toEqual({
      path: "/admin/setup",
      tokenRequired: false,
    });
    expect(resolveAdminSetup({ source }, "/cms").advertised.path).toBe("/cms/setup");
  });

  it("declares a token requirement exactly when the host set one", () => {
    const { source } = stubSource();

    expect(
      resolveAdminSetup({ source, token: "t" }, "/admin").advertised.tokenRequired,
    ).toBe(true);
  });

  it("takes an explicit path over the default", () => {
    const { source } = stubSource();

    expect(
      resolveAdminSetup({ source, path: "/bootstrap" }, "/admin").advertised.path,
    ).toBe("/bootstrap");
  });
});

describe("createAdminSetupHandler", () => {
  it("creates the first account and answers with the session", async () => {
    const { source, created } = stubSource();
    const handler = createAdminSetupHandler(resolveAdminSetup({ source }, "/admin"));

    const response = await handler(post(VALID));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("set-cookie")).toBe("session=1");
    expect(created).toEqual([VALID.email]);
  });

  it("declines every path but its own", async () => {
    const { source } = stubSource();
    const handler = createAdminSetupHandler(resolveAdminSetup({ source }, "/admin"));

    expect(await handler(post(VALID))).toBeDefined();
    expect(
      await handler(new Request("http://x/admin/schema.json", { method: "POST" })),
    ).toBeUndefined();
  });

  it("refuses once an account exists, and creates nothing", async () => {
    const { source, created } = stubSource();
    const handler = createAdminSetupHandler(resolveAdminSetup({ source }, "/admin"));
    await handler(post(VALID));

    const second = await handler(post({ ...VALID, email: "second@example.com" }));

    expect(second?.status).toBe(409);
    expect(created).toEqual([VALID.email]);
  });

  it("serialises simultaneous attempts, so exactly one account is created", async () => {
    // `create` is slow on purpose: without the lock both requests pass `required()` before either
    // finishes, and both create an administrator.
    const { source, created } = stubSource(20);
    const handler = createAdminSetupHandler(resolveAdminSetup({ source }, "/admin"));

    const responses = await Promise.all([
      handler(post(VALID)),
      handler(post({ ...VALID, email: "second@example.com" })),
      handler(post({ ...VALID, email: "third@example.com" })),
    ]);

    expect(created).toEqual([VALID.email]);
    expect(responses.filter((response) => response?.status === 409)).toHaveLength(2);
  });

  it("rejects a bad body before asking the source to create anything", async () => {
    const { source, created } = stubSource();
    const handler = createAdminSetupHandler(resolveAdminSetup({ source }, "/admin"));

    const response = await handler(post({ email: "nope", password: "x" }));

    expect(response?.status).toBe(400);
    expect(created).toEqual([]);
  });

  it("keeps the window open after a rejected attempt", async () => {
    const { source } = stubSource();
    const handler = createAdminSetupHandler(resolveAdminSetup({ source }, "/admin"));
    await handler(post({}));

    expect((await handler(post(VALID)))?.status).toBe(200);
  });

  it("refuses a missing or wrong token, and accepts the right one", async () => {
    const { source } = stubSource();
    const resolved = resolveAdminSetup({ source, token: "s3cret" }, "/admin");
    const handler = createAdminSetupHandler(resolved, "s3cret");

    expect((await handler(post(VALID)))?.status).toBe(403);
    expect((await handler(post({ ...VALID, token: "nope" })))?.status).toBe(403);
    expect((await handler(post({ ...VALID, token: "s3cret" })))?.status).toBe(200);
  });

  it("takes the token from a header as well as the body", async () => {
    const { source } = stubSource();
    const handler = createAdminSetupHandler(
      resolveAdminSetup({ source, token: "s3cret" }, "/admin"),
      "s3cret",
    );

    const response = await handler(post(VALID, { "x-shuri-setup-token": "s3cret" }));

    expect(response?.status).toBe(200);
  });

  it("refuses anything but a POST", async () => {
    const { source } = stubSource();
    const handler = createAdminSetupHandler(resolveAdminSetup({ source }, "/admin"));

    const response = await handler(new Request("http://x/admin/setup"));

    expect(response?.status).toBe(405);
  });

  it("survives a source that throws, without wedging the queue", async () => {
    const failing: AdminSetupSource = {
      required: async () => true,
      create: vi
        .fn<AdminSetupSource["create"]>()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue(new Response(null, { status: 200 })),
    };
    const handler = createAdminSetupHandler(
      resolveAdminSetup({ source: failing }, "/admin"),
    );

    await expect(handler(post(VALID))).rejects.toThrow("boom");
    expect((await handler(post(VALID)))?.status).toBe(200);
  });
});
