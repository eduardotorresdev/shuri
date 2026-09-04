import { describe, expect, it } from "vitest";
import { readBearerToken } from "./bearer.js";

function withAuthorization(value?: string): Request {
  return new Request("http://localhost/", {
    headers: value === undefined ? {} : { authorization: value },
  });
}

describe("readBearerToken", () => {
  it("reads the token, case-insensitively on the scheme", () => {
    expect(readBearerToken(withAuthorization("Bearer abc"))).toBe("abc");
    expect(readBearerToken(withAuthorization("bearer abc"))).toBe("abc");
  });

  it("is undefined without the header, for another scheme, or for an empty token", () => {
    expect(readBearerToken(withAuthorization())).toBeUndefined();
    expect(readBearerToken(withAuthorization("Basic abc"))).toBeUndefined();
    expect(readBearerToken(withAuthorization("Bearer   "))).toBeUndefined();
  });
});
