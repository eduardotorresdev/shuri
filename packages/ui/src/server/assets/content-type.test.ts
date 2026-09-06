import { describe, expect, it } from "vitest";
import { contentTypeOf } from "./content-type.js";

describe("contentTypeOf", () => {
  it("types the bundle's own kinds of file", () => {
    expect(contentTypeOf("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeOf("_app/immutable/entry/app.CtEwdBBb.js")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(contentTypeOf("_app/immutable/assets/0.DHz4T5nA.css")).toBe(
      "text/css; charset=utf-8",
    );
    expect(contentTypeOf("favicon.svg")).toBe("image/svg+xml");
  });

  it("ignores the case of the extension", () => {
    expect(contentTypeOf("logo.PNG")).toBe("image/png");
  });

  it("falls back to a type browsers download rather than guess at", () => {
    expect(contentTypeOf("data.bin")).toBe("application/octet-stream");
    expect(contentTypeOf("LICENSE")).toBe("application/octet-stream");
  });
});
