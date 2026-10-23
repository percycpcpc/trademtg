import type { Finish, FoilPref, Want } from "./client-types";

export function validQuantity(value: string, max = 9999) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;
}
export function validPrice(value: string) {
  return /^\d+(?:\.\d{1,2})?$/.test(value) && value.split(".")[0].length <= 10;
}
export function validTargetPrice(value: string) {
  return value === "" || (/^\d+(?:\.\d{1,2})?$/.test(value) && value.split(".")[0].length <= 8);
}
export function finishMismatch(pref: FoilPref, finish: Finish) {
  return pref !== "either" && pref !== finish;
}
export function aboveTarget(unitPrice: string, target: string | null) {
  if (target === null) return false;
  const cents = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  };
  return cents(unitPrice) > cents(target);
}
export function amount(value: string, qty = 1) {
  const [whole, fraction = ""] = value.split(".");
  const cents =
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * BigInt(qty);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
export function tileStatus(want: Want) {
  const active = want.offers.filter((o) => o.status !== "withdrawn");
  const accepted = active.find((o) => o.id === want.acceptedOfferId);
  return accepted
    ? `${accepted.qty}/${want.qty} accepted${accepted.qty < want.qty ? ` · ${want.qty - accepted.qty} still needed` : ""}`
    : `Need ${want.qty}${active.length ? ` · ${active.length} ${active.length === 1 ? "offer" : "offers"}` : ""}`;
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
