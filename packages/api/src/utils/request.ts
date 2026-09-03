import type { RecordInput } from "@shuri/store";
import { InvalidJsonBodyError } from "../errors.js";

export async function readJsonBody(request: Request): Promise<RecordInput> {
  try {
    return (await request.json()) as RecordInput;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
