import { describe, expect, it } from "vitest";
import { createTestApp } from "./support.js";

describe("client.globals", () => {
  it("reads and updates a global, typed from the schema", async () => {
    const { client } = createTestApp();
    const site = client.globals.site;

    expect(await site.get()).toEqual({});
    const updated = await site.update({ name: "Acme" });
    const name: string = updated.name;
    expect(name).toBe("Acme");
    expect(await site.get()).toEqual({ name: "Acme" });

    // @ts-expect-error "name" is a text field
    void site.update({ name: 1 }).catch(() => {});
    // @ts-expect-error unknown global
    void client.globals.nope;
  });
});
