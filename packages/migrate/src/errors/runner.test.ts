import { describe, expect, it } from "vitest";
import { idAt } from "../migration/test-support.js";
import { add, col, dropField, int, text } from "../ops/test-support.js";
import {
  ChecksumMismatchError,
  DestructiveMigrationError,
  DriverLimitError,
  LockLostError,
  MigrationLockedError,
  OutOfOrderConflictError,
  PendingMigrationsError,
  RenameCollisionError,
  SchemaDriftError,
  UnknownAppliedMigrationError,
} from "./runner.js";

const posts = col("posts");

describe("runner errors", () => {
  it("each carries its fields and its class name", () => {
    const errors = [
      [new SchemaDriftError([add(posts, "x", int)]), "SchemaDriftError"],
      [new PendingMigrationsError(["a"], ["b"]), "PendingMigrationsError"],
      [new DriverLimitError([{ path: "p", message: "m" }]), "DriverLimitError"],
      [new MigrationLockedError("h", "t"), "MigrationLockedError"],
      [new LockLostError("h"), "LockLostError"],
      [new DestructiveMigrationError([]), "DestructiveMigrationError"],
      [new ChecksumMismatchError(["a"]), "ChecksumMismatchError"],
      [new UnknownAppliedMigrationError(["a"]), "UnknownAppliedMigrationError"],
    ] as const;
    for (const [error, name] of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
    }
  });

  it("every message ends with the next command to run", () => {
    const next = [
      new SchemaDriftError([add(posts, "x", int)]),
      new PendingMigrationsError(["a"], []),
      new DriverLimitError([{ path: "p", message: "m" }]),
      new MigrationLockedError("h", "t"),
      new LockLostError("h"),
      new DestructiveMigrationError([{ migration: "a", op: dropField(posts, "x") }]),
      new ChecksumMismatchError(["a"]),
      new UnknownAppliedMigrationError(["a"]),
      new OutOfOrderConflictError(["a"], {
        commutes: false,
        reason: "divergent",
        conflicts: [],
      }),
    ].map((error) => error.message);
    for (const message of next) expect(message).toMatch(/`shuri-migrate [^`]+`[^`]*$/);
  });

  it("describes what is wrong, not just that something is", () => {
    expect(new SchemaDriftError([add(posts, "x", int)]).message).toContain("addField x");
    expect(new PendingMigrationsError(["m1"], ["m2"]).message).toMatch(
      /pending: m1.*interrupted: m2/,
    );
    expect(
      new MigrationLockedError("ci-1", "2026-01-01T00:00:00.000Z").message,
    ).toContain("ci-1");
    expect(
      new DestructiveMigrationError([
        { migration: idAt(4), op: dropField(posts, "x") },
        { migration: idAt(4), op: dropField(posts, "y") },
      ]).message,
    ).toContain(`--allow-destructive ${idAt(4)}`);
    expect(new ChecksumMismatchError(["a", "b"]).message).toContain("repair-checksum a");
  });

  it("OutOfOrderConflictError names the clashing resources", () => {
    const op = add(posts, "f", text);
    const ref = (migration: string) => ({ migration, index: 0, op });
    const error = new OutOfOrderConflictError(["a"], {
      commutes: false,
      reason: "divergent",
      conflicts: [{ a: ref("a"), b: ref("b"), resource: "f:collection:posts.f" }],
    });
    expect(error.ids).toEqual(["a"]);
    expect(error.message).toContain("f:collection:posts.f");
  });
});

describe("RenameCollisionError", () => {
  it("names the entity, the destination and a sample of the colliding ids", () => {
    const error = new RenameCollisionError(posts, "articles", ["a", "b"]);
    expect(error).toMatchObject({
      name: "RenameCollisionError",
      target: posts,
      to: "articles",
      sampleIds: ["a", "b"],
    });
    expect(error.message).toBe(
      "cannot rename collection posts to articles: articles already has data (e.g. a, b)",
    );
  });

  it("has no sample for a whole-entity collision", () => {
    expect(new RenameCollisionError(posts, "articles").sampleIds).toEqual([]);
  });
});
