import type { DeliveryItem, Finish, FoilPref, Party, Want } from "./client-types";

const colorSections = [
  "White",
  "Blue",
  "Black",
  "Red",
  "Green",
  "Multi",
  "Colorless",
];
const typeSections = [
  "Land",
  "Battle",
  "Planeswalker",
  "Creature",
  "Instant",
  "Sorcery",
  "Enchantment",
  "Artifact",
  "Other",
];
const rarityOrder: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
};

function colorGroup(want: Want) {
  return want.colors.length > 1
    ? "Multi"
    : ((
        { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as Record<
          string,
          string
        >
      )[want.colors[0]] ?? "Colorless");
}

export function typeGroup(typeLine: string | null): string {
  if (typeLine)
    for (const section of typeSections.slice(0, -1))
      if (new RegExp(`\\b${section}\\b`, "i").test(typeLine)) return section;
  return "Other";
}

const compareWants = (a: Want, b: Want) =>
  (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9) ||
  a.cardName.localeCompare(b.cardName);

export function groupWants(
  wants: Want[],
  mode: "color" | "set" | "type",
): { section: string; cards: Want[] }[] {
  const sectionFor =
    mode === "color"
      ? colorGroup
      : mode === "set"
        ? (want: Want) => want.setCode.toUpperCase()
        : (want: Want) => typeGroup(want.typeLine);
  const bySection = new Map<string, Want[]>();
  for (const want of wants) {
    const section = sectionFor(want);
    bySection.set(section, [...(bySection.get(section) ?? []), want]);
  }
  const sections =
    mode === "color"
      ? colorSections
      : mode === "type"
        ? typeSections
        : [...bySection.keys()].sort((a, b) => a.localeCompare(b));
  return sections.flatMap((section) => {
    const cards = bySection.get(section);
    return cards?.length ? [{ section, cards: [...cards].sort(compareWants) }] : [];
  });
}

export function validQuantity(value: string, max = 9999) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;
}
export function validTargetPrice(value: string) {
  return value === "" || (/^\d+(?:\.\d{1,2})?$/.test(value) && value.split(".")[0].length <= 8);
}
export function finishMismatch(pref: FoilPref, finish: Finish) {
  return pref !== "either" && pref !== finish;
}
export function composeDeliveries(deliveries: DeliveryItem[]) {
  const groups = new Map<string, { buyer: Party; items: DeliveryItem[] }>();
  for (const row of deliveries) {
    const group = groups.get(row.buyer.id) ?? { buyer: row.buyer, items: [] };
    group.items.push(row);
    groups.set(row.buyer.id, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.buyer.name.localeCompare(b.buyer.name));
}
export function tileStatus(want: Want) {
  const active = want.offers.filter((o) => o.status === "open");
  return `Need ${want.qty}${active.length ? ` · ${active.length} ${active.length === 1 ? "offer" : "offers"}` : ""}`;
}
export function printingCaption(printings: Pick<Want["printings"][number], "setCode">[]) {
  const codes = [...new Set(printings.map((printing) => printing.setCode.toUpperCase()))];
  if (!codes.length) return "any";
  const visible = codes.slice(0, 2).join(", ");
  return `any · ${visible}${codes.length > 2 ? ` +${codes.length - 2}` : ""}`;
}
export type ImportReport = {
  batchId: string;
  baseRevision: number;
  lines: {
    id: string;
    lineNo: number;
    state: string;
    scryfallId: string | null;
    qty: number | null;
    rawText: string;
    reason: string | null;
  }[];
  proposedItems: {
    scryfallId: string;
    currentQty: number;
    importQty: number;
    targetQty: number;
    card: { cardName: string; setCode: string; collectorNo: string };
  }[];
};
export function reviewCounts(report: ImportReport) {
  return {
    cards: new Set(report.proposedItems.map((x) => x.scryfallId)).size,
    copies: report.proposedItems.reduce((sum, x) => sum + x.importQty, 0),
    issues: report.lines.filter(
      (x) => x.state === "unresolved" && !x.scryfallId,
    ).length,
    ignored: report.lines.filter((x) => x.state === "ignored").length,
  };
}

// A rejected operation must not poison subsequent operations on the same list.
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job);
    tail = result.catch(() => undefined);
    return result;
  };
}
