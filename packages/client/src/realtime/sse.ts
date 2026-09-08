/** One Server-Sent Events message: the `event:` name and the joined `data:` lines. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Reads an SSE body to its end, calling `onMessage` per message. Follows the spec's line protocol:
 * a message is the lines up to a blank line; `event:` names it, `data:` lines are joined with
 * newlines, a line starting with `:` is a comment (the server's keep-alive), and anything else is
 * ignored. Resolves when the stream ends, rejects when reading it fails.
 * @param body - The response body to read.
 * @param onMessage - Called once per complete message.
 * @returns Nothing; resolves once the stream has ended.
 */
export async function parseEventStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (chunk: string): void => {
    const message = parseMessage(chunk);
    if (message) onMessage(message);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) flush(chunk);
    }
    if (buffer.trim()) flush(buffer);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses one message's lines. Returns `undefined` for a comment-only or data-less chunk.
 * @param chunk - The lines of one message, without the terminating blank line.
 * @returns The message, or `undefined` when the chunk carries none.
 */
export function parseMessage(chunk: string): SseMessage | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}
