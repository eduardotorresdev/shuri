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

export class UnknownRouteError extends ApiError {
  constructor() {
    super(404, "Not found");
    this.name = "UnknownRouteError";
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

/** The query string doesn't satisfy the `Query` AST shape (see `@shuri/store`'s `Query`). */
export class InvalidQueryError extends ApiError {
  constructor(public readonly issues: Issue[]) {
    super(400, formatIssues(issues));
    this.name = "InvalidQueryError";
  }
}
