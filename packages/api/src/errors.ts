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
