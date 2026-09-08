import { describe, expect, it } from "vitest";
import { AccessRuleError } from "./errors.js";
import { authorizeCollection, authorizeGlobal, evaluateRule } from "./policy.js";
import type { AccessContext, Principal } from "./types.js";

const anonymous: AccessContext = { principal: { kind: "anonymous" } };
const user: AccessContext = {
  principal: { kind: "user", user: { id: "u1" } },
  user: { id: "u1" },
};
function client(...scopes: string[]): AccessContext {
  const principal: Principal = {
    kind: "client",
    client: { id: "c1", name: "bot" },
    scopes: new Set(scopes),
  };
  return { principal, client: principal.client };
}

describe("evaluateRule", () => {
  it("passes a boolean through and calls a function, sync or async", async () => {
    expect(await evaluateRule(true, anonymous)).toBe(true);
    expect(await evaluateRule(() => false, anonymous)).toBe(false);
    expect(
      await evaluateRule(async () => ({ a: { op: "eq", value: 1 } }), anonymous),
    ).toEqual({
      a: { op: "eq", value: 1 },
    });
  });
});

describe("authorizeCollection with no rule declared", () => {
  const posts = { slug: "posts" };

  it("denies anonymous and allows any user", async () => {
    expect(await authorizeCollection(posts, "list", anonymous)).toBe(false);
    expect(await authorizeCollection(posts, "list", user)).toBe(true);
  });

  it("requires the exact scope from a client", async () => {
    expect(await authorizeCollection(posts, "list", client("posts:list"))).toBe(true);
    expect(await authorizeCollection(posts, "create", client("posts:list"))).toBe(false);
    expect(await authorizeCollection(posts, "list", client())).toBe(false);
  });
});

describe("authorizeCollection with a rule declared", () => {
  it("lets the rule decide for anonymous, with no user in the context", async () => {
    const seen: AccessContext[] = [];
    const posts = {
      slug: "posts",
      access: {
        list: (ctx: AccessContext) => {
          seen.push(ctx);
          return true;
        },
      },
    };
    expect(await authorizeCollection(posts, "list", anonymous)).toBe(true);
    expect(seen[0].user).toBeUndefined();
  });

  it("passes id and data through to the rule", async () => {
    const seen: AccessContext[] = [];
    const posts = {
      slug: "posts",
      access: {
        update: (ctx: AccessContext) => {
          seen.push(ctx);
          return true;
        },
      },
    };
    await authorizeCollection(posts, "update", {
      ...user,
      id: "p1",
      data: { title: "x" },
    });
    expect(seen[0]).toMatchObject({ id: "p1", data: { title: "x" } });
  });

  it("returns the rule's Where for a row op", async () => {
    const posts = {
      slug: "posts",
      access: {
        list: (ctx: AccessContext) => ({
          author: { op: "eq" as const, value: ctx.user?.id },
        }),
      },
    };
    expect(await authorizeCollection(posts, "list", user)).toEqual({
      author: { op: "eq", value: "u1" },
    });
  });

  it("throws AccessRuleError when a create rule answers with a Where", async () => {
    const posts = {
      slug: "posts",
      access: { create: () => ({ a: { op: "eq" as const, value: 1 } }) },
    };
    await expect(authorizeCollection(posts, "create", user)).rejects.toThrow(
      AccessRuleError,
    );
  });

  it("never lets a public rule spare a client its scope", async () => {
    const posts = { slug: "posts", access: { list: true } };
    expect(await authorizeCollection(posts, "list", client())).toBe(false);
    expect(await authorizeCollection(posts, "list", client("posts:list"))).toBe(true);
  });

  it("lets the rule narrow a client that has the scope", async () => {
    const posts = {
      slug: "posts",
      access: { delete: (ctx: AccessContext) => !ctx.client },
    };
    expect(await authorizeCollection(posts, "delete", client("posts:delete"))).toBe(
      false,
    );
    expect(await authorizeCollection(posts, "delete", user)).toBe(true);
  });
});

describe("authorizeGlobal", () => {
  it("applies the same defaults and scope check", async () => {
    const site = { slug: "site" };
    expect(await authorizeGlobal(site, "read", anonymous)).toBe(false);
    expect(await authorizeGlobal(site, "read", user)).toBe(true);
    expect(await authorizeGlobal(site, "update", client("site:read"))).toBe(false);
    expect(await authorizeGlobal(site, "update", client("site:update"))).toBe(true);
  });

  it("throws AccessRuleError when a rule answers with a Where", async () => {
    const site = {
      slug: "site",
      access: { read: () => ({ a: { op: "eq" as const, value: 1 } }) },
    };
    await expect(authorizeGlobal(site, "read", user)).rejects.toThrow(AccessRuleError);
  });
});
