export interface Issue {
  path: string;
  message: string;
}

export interface ValidationContext {
  readonly path: string;
  addIssue(message: string): void;
  at(segment: string | number): ValidationContext;
}

export type Validator<T> = (value: T, ctx: ValidationContext) => void;
