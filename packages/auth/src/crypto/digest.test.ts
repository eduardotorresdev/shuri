import { describe, expect, it } from "vitest";
import { sha256, sha256Base64Url } from "./digest.js";

describe("sha256", () => {
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Base64Url("")).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  });

  it("is deterministic and 32 bytes wide", async () => {
    expect(await sha256("token")).toEqual(await sha256("token"));
    expect((await sha256("token")).length).toBe(32);
  });

  it("differs for different inputs", async () => {
    expect(await sha256Base64Url("a")).not.toBe(await sha256Base64Url("b"));
  });
});
