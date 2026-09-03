import { formatIssues, type Issue } from "@shuri/validate";

/** Reports a record given to `insert`/`update` that violates the collection's or global's declared fields. */
export class RecordValidationError extends Error {
  constructor(
    public readonly collection: string,
    public readonly issues: Issue[],
  ) {
    super(formatIssues(issues));
    this.name = "RecordValidationError";
  }
}
