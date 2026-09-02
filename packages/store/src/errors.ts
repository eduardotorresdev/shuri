import type { RecordId } from "./record.js";

export class RecordNotFoundError extends Error {
  constructor(
    public readonly collection: string,
    public readonly id: RecordId,
  ) {
    super(`Record "${id}" not found in collection "${collection}"`);
    this.name = "RecordNotFoundError";
  }
}
