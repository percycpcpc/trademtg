import { describe, expect, it } from "vitest";
import {
  amount,
  reviewCounts,
  serialQueue,
  tileStatus,
  validPrice,
  validQuantity,
  type ImportReport,
} from "./ux";
import type { Want } from "./client-types";

describe("offer entry", () => {
  it.each(["", " ", ".", "1.", "-1", "1e2", "0.001"])(
    "keeps partial/invalid price %j unsaved",
    (value) => expect(validPrice(value)).toBe(false),
  );
  it("accepts deliberate free offers and formats integer cents without float rounding", () => {
    expect(validPrice("0")).toBe(true);
    expect(amount("0")).toBe("0.00");
    expect(amount("0.29", 3)).toBe("0.87");
    expect(amount("9999999999.99", 9999)).toBe("99989999999900.01");
  });
  it("rejects blank, fractional, zero and excessive quantities", () => {
    for (const value of ["", "0", "1.5", "5"])
      expect(validQuantity(value, 4)).toBe(false);
    expect(validQuantity("4", 4)).toBe(true);
  });
});
describe("import review presentation", () => {
  it("counts distinct printings, physical issue/skipped lines, and added rather than target copies", () => {
    const report: ImportReport = {
      batchId: "batch",
      baseRevision: 2,
      proposedItems: [
        {
          scryfallId: "a",
          currentQty: 2,
          importQty: 7,
          targetQty: 9,
          card: { cardName: "Bolt", setCode: "m11", collectorNo: "149" },
        },
        {
          scryfallId: "b",
          currentQty: 0,
          importQty: 1,
          targetQty: 1,
          card: { cardName: "Island", setCode: "lea", collectorNo: "1" },
        },
      ],
      lines: [
        ...["a", "a", "b", null, null].map((id, i) => ({
          id: String(i),
          lineNo: i + 1,
          state: "unresolved",
          scryfallId: id,
          qty: 1,
          rawText: "line",
          reason: null,
        })),
        {
          id: "6",
          lineNo: 6,
          state: "ignored",
          scryfallId: null,
          qty: null,
          rawText: "Deck:",
          reason: null,
        },
      ],
    };
    expect(reviewCounts(report)).toEqual({
      cards: 2,
      copies: 8,
      issues: 2,
      ignored: 1,
    });
  });
});
describe("gallery coverage", () => {
  const want = {
    qty: 4,
    acceptedOfferId: null,
    offers: [
      { id: "a", qty: 2, status: "open" },
      { id: "b", qty: 4, status: "withdrawn" },
    ],
  } as Want;
  it("does not sum competing open offers as coverage and uses singular copy", () =>
    expect(tileStatus(want)).toBe("Need 4 · 1 offer"));
  it("explains partial acceptance", () =>
    expect(tileStatus({ ...want, acceptedOfferId: "a" })).toBe(
      "2/4 accepted · 2 still needed",
    ));
  it("omits remaining copy text at full coverage", () =>
    expect(tileStatus({ ...want, qty: 2, acceptedOfferId: "a" })).toBe(
      "2/2 accepted",
    ));
});
describe("per-list operation queue", () => {
  it("waits for the previous write, uses its revision, and recovers after failure", async () => {
    const enqueue = serialQueue(),
      seen: number[] = [];
    let revision = 1;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueue(async () => {
      seen.push(revision);
      await pending;
      revision++;
    });
    const second = enqueue(async () => {
      seen.push(revision);
      throw new Error("offline");
    });
    const rejection = expect(second).rejects.toThrow("offline");
    const third = enqueue(async () => {
      seen.push(revision);
      revision++;
    });
    await Promise.resolve();
    expect(seen).toEqual([1]);
    release();
    await first;
    await rejection;
    await third;
    expect(seen).toEqual([1, 2, 2]);
    expect(revision).toBe(3);
  });
});
