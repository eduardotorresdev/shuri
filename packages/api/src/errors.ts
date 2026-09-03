import { formatIssues, type Issue } from "@shuri/validate";

/** Base for errors that already know which HTTP status they map to. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Base for errors carrying validation `issues`, which `toErrorResponse` puts in the response body
 * alongside the message — every subclass gets that for free.
 */
export class IssuesApiError extends ApiError {
  constructor(
    status: number,
    public readonly issues: Issue[],
  ) {
    super(status, formatIssues(issues));
    this.name = "IssuesApiError";
  }
}

export class MethodNotAllowedError extends ApiError {
  constructor(method: string) {
    super(405, `Method "${method}" not allowed`);
    this.name = "MethodNotAllowedError";
  }
}

export class InvalidJsonBodyError extends ApiError {
  constructor() {
    super(400, "Invalid JSON body");
    this.name = "InvalidJsonBodyError";
  }
}
