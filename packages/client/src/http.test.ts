import { describe, expect, it } from "vitest";
import { createHttp, originOf } from "./http.js";

/**
 * A `fetch` that records what it was asked and answers 200.
 * @returns The fetch and the requests it saw.
 */
function recordingFetch() {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    return new Response(null, { status: 204 });
  };
  const headerOf = (index: number, name: string) =>
    new Headers(seen[index]?.init.headers).get(name);
  return { fetch, seen, headerOf };
}

describe("originOf", () => {
  it("is the scheme, host and port of an absolute base URL, whatever its path", () => {
    expect(originOf("https://cms.example.com:8443/api/")).toBe(
      "https://cms.example.com:8443",
    );
  });

  it("is nothing for a relative one, which only a browser page passes", () => {
    expect(originOf("/api")).toBeUndefined();
  });
});

describe("createHttp origin", () => {
  it("names the server as Origin on a state-changing request, never on a read", async () => {
    const { fetch, headerOf } = recordingFetch();
    const http = createHttp({ baseUrl: "http://localhost:3000/api", fetch });

    await http.send("POST", "/auth/sign-out");
    await http.send("GET", "/collections/posts");

    expect(headerOf(0, "origin")).toBe("http://localhost:3000");
    expect(headerOf(1, "origin")).toBeNull();
  });

  it("leaves an Origin the caller set alone", async () => {
    const { fetch, headerOf } = recordingFetch();
    const http = createHttp({ baseUrl: "http://localhost:3000", fetch });

    await http.send("POST", "/x", { headers: { origin: "https://app.example.com" } });

    expect(headerOf(0, "origin")).toBe("https://app.example.com");
  });

  it("sends none when the base URL is relative", async () => {
    const { fetch, headerOf } = recordingFetch();
    const http = createHttp({ baseUrl: "/api", fetch });

    await http.send("POST", "/x");

    expect(headerOf(0, "origin")).toBeNull();
  });
});
