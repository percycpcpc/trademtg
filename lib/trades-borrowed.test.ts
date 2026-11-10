import { describe, expect, it } from "vitest";
import {
  composeBorrowedSections,
  decodeTradeCursor,
  encodeTradeCursor,
  paginationLimit,
  tradeSnapshotQuantities,
} from "./trades-borrowed";
import {
  parseBorrowBody,
  parseBorrowStatus,
  validateBorrowParties,
} from "./server";

const borrowerId = "00000000-0000-4000-8000-000000000001";
const lenderId = "00000000-0000-4000-8000-000000000002";
const scryfallId = "00000000-0000-4000-8000-000000000003";

describe("trade and borrow validation", () => {
  it("parses a valid borrow", () => {
    expect(parseBorrowBody({ borrowerId, lenderId, scryfallId, qty: 2 })).toEqual({
      borrowerId,
      lenderId,
      scryfallId,
      qty: 2,
    });
  });
  it("rejects identical parties and out-of-range quantities", () => {
    expect(() => parseBorrowBody({ borrowerId, lenderId: borrowerId, scryfallId, qty: 1 })).toThrow(/different/);
    expect(() => parseBorrowBody({ borrowerId, lenderId, scryfallId, qty: 0 })).toThrow(/Quantity/);
    expect(() => parseBorrowBody({ borrowerId, lenderId, scryfallId, qty: 10000 })).toThrow(/Quantity/);
  });
  it("validates import parties independently of a card", () => {
    expect(validateBorrowParties(borrowerId, lenderId)).toEqual({ borrowerId, lenderId });
    expect(() => validateBorrowParties(borrowerId, borrowerId)).toThrow(/different/);
    expect(() => validateBorrowParties("bad", lenderId)).toThrow(/required/);
  });
  it.each(["outstanding", "returned"] as const)("accepts borrow status %s", (status) => {
    expect(parseBorrowStatus(status)).toBe(status);
  });
  it("rejects any other borrow status", () => {
    expect(() => parseBorrowStatus("lost")).toThrow(/status/);
  });
});

describe("trade snapshots and history pagination", () => {
  it.each([[4, 6, 4], [6, 4, 4], [6, 0, 0]])(
    "deducts min(%i, %i) = %i",
    (offerQty, wantQty, deductedQty) =>
      expect(tradeSnapshotQuantities(offerQty, wantQty)).toEqual({ qty: offerQty, deductedQty }),
  );
  it("defaults and clamps page size", () => {
    expect(paginationLimit(undefined)).toBe(50);
    expect(paginationLimit("0")).toBe(50);
    expect(paginationLimit("75")).toBe(75);
    expect(paginationLimit("500")).toBe(100);
  });
  it("round-trips opaque cursors and rejects malformed cursors", () => {
    expect(decodeTradeCursor(encodeTradeCursor(scryfallId))).toBe(scryfallId);
    expect(decodeTradeCursor("not-json")).toBeNull();
  });
});

describe("borrowed view composition", () => {
  const ledger = [
    { id: "borrowed", borrowerId, lenderId, status: "outstanding" as const },
    { id: "lent", borrowerId: lenderId, lenderId: borrowerId, status: "outstanding" as const },
    { id: "returned", borrowerId, lenderId, status: "returned" as const },
  ];
  it("separates outstanding borrowed and lent cards", () => {
    const result = composeBorrowedSections(borrowerId, ledger);
    expect(result.borrowed.map((x) => x.id)).toEqual(["borrowed"]);
    expect(result.lent.map((x) => x.id)).toEqual(["lent"]);
  });
});
