import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * `@shuri/sdk`'s `app.handler` is a web-standard `fetch` handler (`Request` in, `Response` out) so
 * it runs unmodified on Deno/Bun. Node has no built-in bridge from `http`'s callback-style server to
 * that shape, so this is the small adapter: buffers the request body (fine for the JSON payloads
 * this demo sends) into a `Request`, then writes the resulting `Response` back onto `ServerResponse`.
 * @param handler - The web-standard `fetch` handler to serve.
 * @param port - The port to listen on.
 * @returns Nothing; the server runs until the process exits.
 */
export function serve(handler: (request: Request) => Promise<Response>, port: number): void {
  createServer((req, res) => {
    toWebRequest(req)
      .then(handler)
      .then((response) => sendWebResponse(response, res))
      .catch((error: unknown) => {
        console.error(error);
        res.writeHead(500).end("Internal Server Error");
      });
  }).listen(port);
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, { method: req.method, headers, body: hasBody ? await readBody(req) : undefined });
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}
