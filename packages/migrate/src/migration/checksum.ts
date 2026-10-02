import { canonicalJson } from "../schema/canonical-json.js";
import type { MigrationFile } from "./types.js";

/**
 * SHA-256 over the canonical JSON of `{format, id, ops}`. `parent` is left out on purpose: the
 * reconciliation only rewrites `parent`, so a rebased migration keeps the checksum already recorded
 * in databases where it ran.
 * @param m - The migration (extra properties such as `parent` are ignored).
 * @returns `sha256:<64 hex digits>`.
 */
export async function checksumOf(
  m: Pick<MigrationFile, "format" | "id" | "ops">,
): Promise<string> {
  const text = canonicalJson({ format: m.format, id: m.id, ops: m.ops });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"));
  return `sha256:${hex.join("")}`;
}
