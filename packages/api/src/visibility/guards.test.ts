import { describe, expect, it } from "vitest";
import { assertQueryableFields, assertWritableRecord } from "./guards.js";
import { HiddenFieldError } from "./errors.js";
import { accountsSchema, sessionsSchema } from "./test-support.js";

describe("assertWritableRecord", () => {
  it("accepts a body touching only visible fields", () => {
    expect(() =>
      assertWritableRecord(accountsSchema, { email: "a@b.com" }),
    ).not.toThrow();
  });

  it("rejects a body writing a hidden field, rather than dropping it silently", () => {
    expect(() =>
      assertWritableRecord(accountsSchema, { passwordHash: "chosen-by-attacker" }),
    ).toThrow(HiddenFieldError);
  });

  it("reports every hidden field the body named, at its own path", () => {
    try {
      assertWritableRecord(accountsSchema, { email: "a@b.com", passwordHash: "x" });
      expect.unreachable();
    } catch (error) {
      expect((error as HiddenFieldError).status).toBe(400);
      expect((error as HiddenFieldError).issues).toEqual([
        {
          path: "body.passwordHash",
          message: '"passwordHash" is not writable over HTTP',
        },
      ]);
    }
  });

  it("is a no-op for a schema hiding nothing", () => {
    expect(() => assertWritableRecord(sessionsSchema, { tokenHash: "x" })).not.toThrow();
  });
});

describe("assertQueryableFields", () => {
  it("accepts a query naming only visible fields", () => {
    expect(() =>
      assertQueryableFields(accountsSchema, {
        where: { email: { op: "eq", value: "a@b.com" } },
        orderBy: [{ field: "email" }],
      }),
    ).not.toThrow();
  });

  it("rejects filtering by a hidden field, which would read it back one guess at a time", () => {
    expect(() =>
      assertQueryableFields(accountsSchema, {
        where: { passwordHash: { op: "contains", value: "a" } },
      }),
    ).toThrow(HiddenFieldError);
  });

  it("rejects sorting by a hidden field", () => {
    expect(() =>
      assertQueryableFields(accountsSchema, { orderBy: [{ field: "passwordHash" }] }),
    ).toThrow(HiddenFieldError);
  });

  it("reports the field under the query path", () => {
    try {
      assertQueryableFields(accountsSchema, {
        where: { passwordHash: { op: "eq", value: "x" } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as HiddenFieldError).issues[0].path).toBe("query.passwordHash");
    }
  });
});
