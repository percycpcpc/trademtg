import { describe, expect, it } from "vitest";

import { isRestrictForeignKeyError } from "./prisma-errors";

describe("isRestrictForeignKeyError", () => {
  it.each(["P2003", "P2014"])("accepts Prisma code %s", (code) => {
    expect(isRestrictForeignKeyError({ code, message: "opaque" })).toBe(true);
  });

  it.each([
    'update or delete on table "Member" violates foreign key constraint "Trade_buyerId_fkey"',
    "Foreign key constraint violated on the constraint: Borrow_lenderId_fkey",
    "Delete restricted by a related row",
  ])("accepts a Restrict/FK message without a code: %s", (message) => {
    expect(isRestrictForeignKeyError({ message })).toBe(true);
  });

  it("does not turn unrelated constraint or transaction errors into conflicts", () => {
    expect(isRestrictForeignKeyError(new Error("unique constraint violated"))).toBe(
      false,
    );
    expect(isRestrictForeignKeyError(new Error("Transaction already closed"))).toBe(
      false,
    );
  });
});
