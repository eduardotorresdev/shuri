import { ValidationError, type Issue } from "@shuri/validate";

export class CollectionSchemaError extends ValidationError {
  constructor(issues: Issue[]) {
    super(issues);
    this.name = "CollectionSchemaError";
  }
}
