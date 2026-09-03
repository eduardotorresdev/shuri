import { describe, expect, it } from "vitest";
import { defineGlobals } from "./define.js";
import { GlobalSchemaError } from "./errors.js";
import type { GlobalSchema } from "./types.js";

describe("defineGlobals", () => {
  it("returns the globals unchanged when valid", () => {
    const globals: GlobalSchema[] = [
      {
        slug: "site",
        title: "Site settings",
        category: { title: "Geral" },
        fields: [{ type: "text", name: "name", required: true }],
      },
    ];

    expect(defineGlobals(globals, new Set())).toBe(globals);
  });

  it("throws a GlobalSchemaError listing every issue", () => {
    const globals: GlobalSchema[] = [
      { slug: "", title: "", category: { title: "" }, fields: [] },
    ];

    expect(() => defineGlobals(globals, new Set())).toThrow(GlobalSchemaError);

    expect.assertions(3);
    try {
      defineGlobals(globals, new Set());
    } catch (error) {
      expect(error).toBeInstanceOf(GlobalSchemaError);
      const schemaError = error as GlobalSchemaError;
      expect(schemaError.issues.length).toBeGreaterThan(1);
    }
  });
});
