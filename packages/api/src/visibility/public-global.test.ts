import { describe, expect, it } from "vitest";
import { createFakeGlobalStore } from "../globals/test-support.js";
import { HiddenFieldError } from "./errors.js";
import { publicGlobal } from "./public-global.js";
import { secretsSchema } from "./test-support.js";

describe("publicGlobal", () => {
  it("strips hidden fields from reads and write echoes, keeping them in the store", async () => {
    const store = createFakeGlobalStore(secretsSchema);
    const api = publicGlobal(store);
    await store.update({ name: "Shuri", apiKey: "k" });

    expect(await api.get()).toEqual({ name: "Shuri" });
    expect(await api.update({ name: "Shuri CMS" })).toEqual({ name: "Shuri CMS" });
    expect(await store.get()).toMatchObject({ apiKey: "k" });
  });

  it("refuses a write naming a hidden field", async () => {
    const api = publicGlobal(createFakeGlobalStore(secretsSchema));
    await expect(api.update({ apiKey: "chosen" })).rejects.toThrow(HiddenFieldError);
  });
});
