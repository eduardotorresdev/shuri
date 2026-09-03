import { formatIssues, type Issue } from "@shuri/validate";
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

/** `Store.collection(slug)` was called with a slug no collection declares. */
export class UnknownCollectionError extends Error {
  constructor(public readonly slug: string) {
    super(`Unknown collection "${slug}"`);
    this.name = "UnknownCollectionError";
  }
}

/** A record given to `insert`/`update` doesn't satisfy the collection's declared fields. */
export class RecordValidationError extends Error {
  constructor(
    public readonly collection: string,
    public readonly issues: Issue[],
  ) {
    super(formatIssues(issues));
    this.name = "RecordValidationError";
  }
}
