import { describe, expect, it } from "vitest";
import {
  composeBorrowedSections,
  decodeTradeCursor,
  encodeTradeCursor,
  paginationLimit,
  tradePaid,
  tradeSnapshotQuantities,
} from "./trades-borrowed";
import {
  parseBorrowBody,
  parseBorrowStatus,
  parseDoneBody,
  parsePaidBody,
  validateBorrowParties,
} from "./server";

const borrowerId = "00000000-0000-4000-8000-000000000001";
const lenderId = "00000000-0000-4000-8000-000000000002";
const scryfallId = "00000000-0000-4000-8000-000000000003";

describe("trade and borrow validation", () => {
  it.each([parseDoneBody, parsePaidBody])("requires a boolean paid value", (parse) => {
    expect(parse({ paid: true })).toEqual({ paid: true });
    expect(() => parse({ paid: "true" })).toThrow(/Paid/);
  });
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

describe("borrowed view debt composition", () => {
  const ledger = [
    { id: "borrowed", borrowerId, lenderId, status: "outstanding" as const },
    { id: "lent", borrowerId: lenderId, lenderId: borrowerId, status: "outstanding" as const },
    { id: "returned", borrowerId, lenderId, status: "returned" as const },
  ];
  const trades = [
    { id: "owes", buyerId: borrowerId, sellerId: lenderId, paidAt: null },
    { id: "owed", buyerId: lenderId, sellerId: borrowerId, paidAt: null },
    { id: "paid", buyerId: borrowerId, sellerId: lenderId, paidAt: "2026-10-26T00:00:00Z" },
  ];
  it("derives paid solely from paidAt", () => {
    expect(tradePaid(null)).toBe(false);
    expect(tradePaid(new Date())).toBe(true);
  });
  it("places borrower debts in Owes and lender receivables in Owed", () => {
    const result = composeBorrowedSections(borrowerId, ledger, trades);
    expect(result.owes.borrows.map((x) => x.id)).toEqual(["borrowed"]);
    expect(result.owes.trades.map((x) => x.id)).toEqual(["owes"]);
    expect(result.owed.borrows.map((x) => x.id)).toEqual(["lent"]);
    expect(result.owed.trades.map((x) => x.id)).toEqual(["owed"]);
  });
});
