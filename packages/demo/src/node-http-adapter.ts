import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/**
 * `@shuri/sdk`'s `app.handler` is a web-standard `fetch` handler (`Request` in, `Response` out) so
 * it runs unmodified on Deno/Bun. Node has no built-in bridge from `http`'s callback-style server to
 * that shape, so this is the small adapter: buffers the request body (fine for the JSON payloads
 * this demo sends) into a `Request`, then streams the resulting `Response` back onto the
 * `ServerResponse`.
 * @param handler - The web-standard `fetch` handler to serve.
 * @param port - The port to listen on.
 * @returns Nothing; the server runs until the process exits.
 */
export function serve(
  handler: (request: Request) => Promise<Response>,
  port: number,
): void {
  createServer((req, res) => {
    toWebRequest(req, res)
      .then(handler)
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
  }).listen(port);
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

/**
 * Writes the headers, flushes them, then streams the body. Flushing matters for an event stream: a
 * client only considers it open once the headers arrive, and the body may then stay open for hours.
 * `pipeline` handles backpressure and teardown, which a hand-rolled reader loop would have to
 * reimplement (`write` returning `false`, waiting for "drain", cancelling on disconnect).
 * @param response - The web-standard response to write back.
 * @param res - The Node response to write it onto.
 * @returns Nothing; resolves once the whole body has been written.
 */
async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.flushHeaders();

  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream), res);
}
