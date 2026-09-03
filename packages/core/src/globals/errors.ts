import { ValidationError, type Issue } from "@shuri/validate";

export class GlobalSchemaError extends ValidationError {
  constructor(issues: Issue[]) {
    super(issues);
    this.name = "GlobalSchemaError";
  }
}
