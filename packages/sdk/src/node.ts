import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { ShuriApp } from "./create.js";

/**
 * Bridges Node's callback-style `http` server to `app.handler`, so serving an app on Node is:
 *
 *   createServer(toNodeListener(app)).listen(3000);
 *
 * `app.handler` is a web-standard `fetch` handler (`Request` in, `Response` out), which Deno, Bun
 * and Workers serve natively; Node has no built-in bridge to that shape, so this is it. The
 * incoming body is buffered into the `Request` (fine for JSON payloads), and the `Response` body is
 * **streamed** back onto the `ServerResponse` — buffering it would hang forever on an event stream,
 * which never ends. Lives in its own subpath (`@shuri/sdk/node`) so importing `@shuri/sdk` never
 * pulls `node:http` into a runtime that doesn't have it.
 * @param app - The app whose `handler` serves every request.
 * @returns A `RequestListener` for `http.createServer`.
 */
export function toNodeListener(app: Pick<ShuriApp, "handler">): RequestListener {
  return (req, res) => {
    toWebRequest(req, res)
      .then(app.handler)
      .then((response) => sendWebResponse(response, res))
      .catch((error: unknown) => {
        // A client that disconnects mid-stream aborts the pipeline; there is no response left to
        // send at that point, headers included.
        if (res.headersSent) {
          res.destroy();
          return;
        }
        console.error(error);
        res.writeHead(500).end("Internal Server Error");
      });
  };
}

/**
 * Builds the web `Request`, wiring the client disconnecting to the request's `AbortSignal`.
 * Deno/Bun/Workers provide that signal natively; on Node it has to come from `res`'s "close", and
 * without it a long-lived response (an event stream, say) would never learn its client is gone.
 * @param req - The incoming Node request.
 * @param res - The Node response, whose "close" marks the client as disconnected.
 * @returns The equivalent web-standard `Request`.
 */
async function toWebRequest(req: IncomingMessage, res: ServerResponse): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined)
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const disconnected = new AbortController();
  res.on("close", () => disconnected.abort());

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? await readBody(req) : undefined,
    signal: disconnected.signal,
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

/** What `settled` answers when a read hasn't completed by the next turn of the event loop. */
const LATER = Symbol("later");

/**
 * Resolves to the read's result if it completes before the next `setImmediate`, `LATER` otherwise.
 * A body built from a string or a buffer resolves its reads in microtasks; an event stream's next
 * read may take minutes. Telling them apart is what lets a small response go out in one write and
 * an event stream flush its headers without waiting for a first frame.
 * @param read - The pending read.
 * @returns The result, or `LATER`.
 */
function settled<T>(read: Promise<T>): Promise<T | typeof LATER> {
  return Promise.race([
    read,
    new Promise<typeof LATER>((resolve) => setImmediate(() => resolve(LATER))),
  ]);
}

/**
 * Resolves once `res` can take more data, or rejects if the client goes away first — without the
 * second arm a stream whose client vanished mid-backpressure would wait for a "drain" that never
 * comes.
 * @param res - The response being written.
 * @returns Resolves on "drain".
 */
function drained(res: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = (): void => {
      res.off("close", onClose);
      resolve();
    };
    const onClose = (): void => {
      res.off("drain", onDrain);
      reject(new Error("client disconnected"));
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
  });
}

type Chunk = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

/**
 * Streams chunks onto `res` as they come, honoring backpressure. The client disconnecting cancels
 * the reader, which settles the pending read as done and ends the loop.
 * @param reader - The body's reader.
 * @param res - The Node response.
 * @param next - The read already in flight.
 * @returns Resolves once the body has been written.
 */
async function pump(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: ServerResponse,
  next: Promise<Chunk>,
): Promise<void> {
  res.once("close", () => {
    reader.cancel().catch(() => undefined);
  });
  for (;;) {
    const chunk = await next;
    if (chunk.done) {
      res.end();
      return;
    }
    if (!res.write(chunk.value)) await drained(res);
    next = reader.read();
  }
}

/**
 * Turns the web headers into Node's shape, `Set-Cookie` kept as separate values.
 * `Object.fromEntries` alone would collapse several `Set-Cookie` values into one comma-joined
 * header, which no browser parses back into separate cookies. `getSetCookie()` is the one accessor
 * that keeps them apart, and the OIDC callback really does set two.
 * @param headers - The web response's headers.
 * @returns The headers for `writeHead`.
 */
function toNodeHeaders(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.fromEntries(headers);
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) result["set-cookie"] = cookies;
  return result;
}

/**
 * Writes the response back, in the cheapest shape its body allows:
 *
 * - **A single-chunk body** (JSON from a string, a buffer): `Content-Length` set, headers and body
 *   in **one write**. This is every REST response, and the case the bridge is optimized for — the
 *   stream machinery of the general path costs more than the whole request otherwise.
 * - **A body whose first chunk isn't there yet** (an event stream): headers flushed at once, so
 *   the client sees the stream open, then chunks as they come with backpressure.
 * - **Anything in between** (a multi-chunk body): headers, then the chunks.
 * @param response - The web-standard response to write back.
 * @param res - The Node response to write it onto.
 * @returns Nothing; resolves once the whole body has been written.
 */
async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers = toNodeHeaders(response.headers);
  if (!response.body) {
    res.writeHead(response.status, headers);
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const firstRead = reader.read();
  const first = await settled(firstRead);
  if (first === LATER) {
    res.writeHead(response.status, headers);
    res.flushHeaders();
    await pump(reader, res, firstRead);
    return;
  }
  if (first.done) {
    res.writeHead(response.status, headers);
    res.end();
    return;
  }

  const secondRead = reader.read();
  const second = await settled(secondRead);
  if (second !== LATER && second.done) {
    headers["content-length"] = String(first.value.byteLength);
    res.writeHead(response.status, headers);
    res.end(first.value);
    return;
  }

  res.writeHead(response.status, headers);
  res.flushHeaders();
  if (!res.write(first.value)) await drained(res);
  await pump(reader, res, secondRead);
}
