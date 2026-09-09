import { ApiError } from "@shuri/api";

/** An operator asked for a user that doesn't exist. */
export class UserNotFoundError extends ApiError {
  constructor(public readonly userId: string) {
    super(404, `User "${userId}" not found`);
    this.name = "UserNotFoundError";
  }
}

/** An operator tried to create, or rename to, an address another account already has. */
export class EmailAlreadyRegisteredError extends ApiError {
  constructor(public readonly email: string) {
    super(409, `Email "${email}" is already registered`);
    this.name = "EmailAlreadyRegisteredError";
  }
}
