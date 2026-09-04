import type { CollectionStore, RecordId, RecordInput, StoreRecord } from "@shuri/store";
import type { Now } from "../types.js";

export interface CreateUserInput {
  email: string;
  passwordHash?: string;
  name?: string;
  emailVerified?: boolean;
}

/** Reads and writes of the `users` collection, in the vocabulary the rest of this package speaks. */
export interface UserService {
  findByEmail(email: string): Promise<StoreRecord<RecordInput> | undefined>;
  findById(id: RecordId): Promise<StoreRecord<RecordInput> | undefined>;
  create(input: CreateUserInput): Promise<StoreRecord<RecordInput>>;
  update(id: RecordId, data: RecordInput): Promise<StoreRecord<RecordInput>>;
}

/**
 * Emails are compared case-insensitively and without surrounding whitespace, so `Ada@Example.com `
 * and `ada@example.com` are one account rather than two.
 * @param email - The address as typed.
 * @returns The normalized address.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Binds the user operations to the `users` collection store.
 *
 * Uniqueness of `email` is check-then-insert here, so it races: a real adapter should carry a unique
 * index on `users.email`. If two rows ever do appear, `findByEmail` sorts by `createdAt` ascending
 * and takes the first, so at least login stays deterministic instead of alternating between them.
 * @param collection - The `users` collection store.
 * @param now - The clock, injectable so tests can control `createdAt`.
 * @returns The user service.
 */
export function createUserService(
  collection: CollectionStore<RecordInput>,
  now: Now,
): UserService {
  return {
    async findByEmail(email) {
      const [user] = await collection.findMany({
        where: { email: { op: "eq", value: normalizeEmail(email) } },
        orderBy: [{ field: "createdAt", direction: "asc" }],
        limit: 1,
      });
      return user;
    },

    findById: (id) => collection.findOne(id),

    create(input) {
      return collection.insert({
        email: normalizeEmail(input.email),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.passwordHash === undefined ? {} : { passwordHash: input.passwordHash }),
        emailVerified: input.emailVerified ?? false,
        createdAt: now(),
      });
    },

    update: (id, data) => collection.update(id, data),
  };
}
