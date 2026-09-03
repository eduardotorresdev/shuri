import { formatIssues, type Issue } from "@shuri/validate";
import { ApiError } from "../errors.js";

/** Thrown by the collections handler when no route matches; `createGlobalsApiHandler`/`createOpenApiHandler` fall through to the next handler in that case. */
export class UnknownRouteError extends ApiError {
  constructor() {
    super(404, "Not found");
    this.name = "UnknownRouteError";
  }
}

/** The query string is invalid against the `Query` AST shape (see `@shuri/store`'s `Query`). Only collection routes accept a query string. */
export class InvalidQueryError extends ApiError {
  constructor(public readonly issues: Issue[]) {
    super(400, formatIssues(issues));
    this.name = "InvalidQueryError";
  }
}
