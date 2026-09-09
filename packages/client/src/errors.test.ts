import { describe, expect, it } from "vitest";
import { toClientError } from "./errors.js";

describe("toClientError", () => {
  it("reads the api's error body, issues included", async () => {
    const error = await toClientError(
      new Response(
        JSON.stringify({ error: "Invalid", issues: [{ path: "a", message: "m" }] }),
        {
          status: 400,
        },
      ),
    );
    expect(error).toMatchObject({
      name: "ClientError",
      status: 400,
      message: "Invalid",
      issues: [{ path: "a", message: "m" }],
    });
  });

  it("reads better-auth's message, and falls back for a non-JSON body", async () => {
    expect(
      await toClientError(
        new Response(
          JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Bad" }),
          {
            status: 400,
          },
        ),
      ),
    ).toMatchObject({ message: "Bad" });
    expect(await toClientError(new Response("boom", { status: 502 }))).toMatchObject({
      status: 502,
      message: "Request failed with status 502",
      issues: undefined,
    });
  });
});
