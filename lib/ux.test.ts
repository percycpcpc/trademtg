import { describe, expect, it } from "vitest";
import {
  amount,
  composeDeliveries,
  aboveTarget,
  finishMismatch,
  groupWants,
  reviewCounts,
  serialQueue,
  tileStatus,
  typeGroup,
  validPrice,
  validQuantity,
  type ImportReport,
} from "./ux";
import type { Want } from "./client-types";
import type { DebtItem, DeliveryItem, Party } from "./client-types";

const groupedWant = (
  cardName: string,
  overrides: Partial<Want> = {},
): Want =>
  ({
    id: cardName,
    scryfallId: cardName,
    cardName,
    imageUrl: null,
    setCode: "lea",
    collectorNo: "1",
    rarity: "common",
    colors: [],
    typeLine: null,
    qty: 1,
    foilPref: "either",
    targetPriceHkd: null,
    offers: [],
    coveredQty: 0,
    remainingQty: 1,
    ...overrides,
  }) as Want;

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
describe("deliveries composition", () => {
  const alice: Party = { id: "a", name: "Alice", color: "red" };
  const bob: Party = { id: "b", name: "Bob", color: "blue" };
  const delivery = (buyer: Party, price: string, qty: number, offerId: string): DeliveryItem => ({
    offerId, wantId: `w-${offerId}`, buyer, cardName: "Lightning Bolt", imageUrl: null,
    setCode: "lea", collectorNo: "161", qty, unitPriceHkd: price, finish: "non-foil",
    updatedAt: "2026-11-10T00:00:00.000Z",
  });
  const debt = (buyer: Party, amountHkd: string, tradeId: string): DebtItem => ({
    tradeId, buyer, cardName: "Island", qty: 1, amountHkd,
    finishedAt: "2026-11-09T00:00:00.000Z",
  });
  it("groups multiple buyers, preserves item order, and sorts by buyer name", () => {
    const result = composeDeliveries([
      delivery(bob, "2.50", 2, "new"), delivery(bob, "1.00", 1, "old"), delivery(alice, "3", 1, "alice"),
    ], []);
    expect(result.map((group) => group.buyer.name)).toEqual(["Alice", "Bob"]);
    expect(result[1].items.map((item) => item.offerId)).toEqual(["new", "old"]);
  });
  it("includes a buyer present only in debts", () => {
    const result = composeDeliveries([], [debt(bob, "4.25", "t1")]);
    expect(result[0]).toMatchObject({ buyer: bob, items: [], debtTotalHkd: "4.25" });
  });
  it("uses exact decimal-string math for delivery subtotals and debts", () => {
    const [group] = composeDeliveries(
      [delivery(alice, "0.29", 3, "a"), delivery(alice, "10.01", 2, "b")],
      [debt(alice, "0.10", "t1"), debt(alice, "12.34", "t2")],
    );
    expect(group.subtotalHkd).toBe("20.89");
    expect(group.debtTotalHkd).toBe("12.44");
  });
});
describe("finish and target guidance", () => {
  it.each([
    ["foil", "foil", false],
    ["foil", "non-foil", true],
    ["non-foil", "foil", true],
    ["non-foil", "non-foil", false],
    ["either", "foil", false],
    ["either", "non-foil", false],
  ] as const)("matches %s preference to %s finish", (pref, finish, expected) => {
    expect(finishMismatch(pref, finish)).toBe(expected);
  });
  it.each([
    ["10.01", "10.00", true],
    ["10", "10.00", false],
    ["9.99", "10", false],
    ["999", null, false],
  ] as const)("compares %s against %s", (price, target, expected) => {
    expect(aboveTarget(price, target)).toBe(expected);
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
    offers: [
      { id: "a", qty: 2, status: "open" },
      { id: "b", qty: 4, status: "withdrawn" },
    ],
  } as Want;
  it("does not sum competing open offers as coverage and uses singular copy", () =>
    expect(tileStatus(want)).toBe("Need 4 · 1 offer"));
  it("keeps the need count when multiple offers are open", () =>
    expect(tileStatus({ ...want, offers: [...want.offers, { id: "c", qty: 1, status: "open" } as any] })).toBe(
      "Need 4 · 2 offers",
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

describe("wantlist grouping", () => {
  it("keeps the existing color sections and order", () => {
    const wants = [
      groupedWant("Colorless"),
      groupedWant("Gold", { colors: ["W", "U"] }),
      groupedWant("Green", { colors: ["G"] }),
      groupedWant("Red", { colors: ["R"] }),
      groupedWant("Black", { colors: ["B"] }),
      groupedWant("Blue", { colors: ["U"] }),
      groupedWant("White", { colors: ["W"] }),
    ];
    expect(groupWants(wants, "color").map(({ section }) => section)).toEqual([
      "White",
      "Blue",
      "Black",
      "Red",
      "Green",
      "Multi",
      "Colorless",
    ]);
  });

  it("orders set sections alphabetically and displays uppercase codes", () => {
    const wants = [
      groupedWant("Third", { setCode: "znr" }),
      groupedWant("First", { setCode: "2xm" }),
      groupedWant("Second", { setCode: "m11" }),
    ];
    expect(groupWants(wants, "set").map(({ section }) => section)).toEqual([
      "2XM",
      "M11",
      "ZNR",
    ]);
  });

  it.each([
    ["Artifact Land", "Land"],
    ["Battle — Siege", "Battle"],
    ["Legendary Planeswalker — Jace", "Planeswalker"],
    ["Legendary Artifact Creature — Golem", "Creature"],
    ["Instant // Sorcery", "Instant"],
    ["Kindred Sorcery — Elf", "Sorcery"],
    ["Enchantment Artifact", "Enchantment"],
    ["Artifact", "Artifact"],
    [null, "Other"],
    ["Kindred — Elf", "Other"],
  ])("classifies %j as %s", (typeLine, expected) => {
    expect(typeGroup(typeLine)).toBe(expected);
  });

  it("sorts cards within a section by rarity and then name", () => {
    const wants = [
      groupedWant("Zulu", { rarity: "common", colors: ["W"] }),
      groupedWant("Beta", { rarity: "rare", colors: ["W"] }),
      groupedWant("Alpha", { rarity: "rare", colors: ["W"] }),
      groupedWant("Myth", { rarity: "mythic", colors: ["W"] }),
      groupedWant("Middle", { rarity: "uncommon", colors: ["W"] }),
    ];
    expect(groupWants(wants, "color")[0].cards.map((want) => want.cardName)).toEqual([
      "Myth",
      "Alpha",
      "Beta",
      "Middle",
      "Zulu",
    ]);
  });
});
