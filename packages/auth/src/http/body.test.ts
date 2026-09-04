import { InvalidJsonBodyError } from "@shuri/api";
import { describe, expect, it } from "vitest";
import { UnsupportedMediaTypeError } from "../errors.js";
import { readJsonObject } from "./body.js";

function post(body: string, contentType?: string): Request {
  return new Request("http://localhost/auth/login", {
    method: "POST",
    body,
    headers: contentType === undefined ? {} : { "content-type": contentType },
  });
}

describe("readJsonObject", () => {
  it("reads a JSON object", async () => {
    expect(await readJsonObject(post('{"a":1}', "application/json"))).toEqual({ a: 1 });
  });

  it("accepts a charset parameter and a +json suffix", async () => {
    expect(await readJsonObject(post("{}", "application/json; charset=utf-8"))).toEqual(
      {},
    );
    expect(await readJsonObject(post("{}", "application/merge-patch+json"))).toEqual({});
  });

  it("refuses a content type a cross-origin form could send", async () => {
    await expect(readJsonObject(post("a=1", "text/plain"))).rejects.toThrow(
      UnsupportedMediaTypeError,
    );
    await expect(
      readJsonObject(post("a=1", "application/x-www-form-urlencoded")),
    ).rejects.toThrow(UnsupportedMediaTypeError);
    await expect(readJsonObject(post("{}"))).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it("refuses a body that isn't a JSON object", async () => {
    await expect(readJsonObject(post("nope", "application/json"))).rejects.toThrow(
      InvalidJsonBodyError,
    );
    await expect(readJsonObject(post("[1]", "application/json"))).rejects.toThrow(
      InvalidJsonBodyError,
    );
    await expect(readJsonObject(post("null", "application/json"))).rejects.toThrow(
      InvalidJsonBodyError,
    );
  });
});
