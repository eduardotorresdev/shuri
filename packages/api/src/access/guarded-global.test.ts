import type { AccessContext, GlobalSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { createFakeGlobalStore } from "../globals/test-support.js";
import { publicGlobal } from "../visibility/public-global.js";
import { ForbiddenError, UnauthenticatedError } from "./errors.js";
import { guardedGlobal } from "./guarded-global.js";
import { ANONYMOUS } from "./principal.js";

const site: GlobalSchema = {
  slug: "site",
  title: "Site",
  category: { title: "Geral" },
  access: { read: () => true, update: (ctx) => ctx.user?.["role"] === "admin" },
  fields: [{ type: "text", name: "name" }],
};

function guarded(ctx: AccessContext) {
  return guardedGlobal(publicGlobal(createFakeGlobalStore(site), {}), site, ctx);
}

describe("guardedGlobal", () => {
  it("lets a public read rule through to anonymous, and refuses the update", async () => {
    const global = guarded({ principal: ANONYMOUS });
    expect(await global.get()).toEqual({});
    await expect(global.update({ name: "x" })).rejects.toThrow(UnauthenticatedError);
  });

  it("passes the user and data to the rule", async () => {
    const editor: AccessContext = {
      principal: { kind: "user", user: { id: "u1", role: "editor" } },
      user: { id: "u1", role: "editor" },
    };
    await expect(guarded(editor).update({ name: "x" })).rejects.toThrow(ForbiddenError);

    const admin: AccessContext = {
      principal: { kind: "user", user: { id: "u2", role: "admin" } },
      user: { id: "u2", role: "admin" },
    };
    expect(await guarded(admin).update({ name: "Shuri" })).toEqual({ name: "Shuri" });
  });
});
