export type BorrowStatusValue = "outstanding" | "returned";

export function tradeSnapshotQuantities(offerQty: number, wantQty: number) {
  return { qty: offerQty, deductedQty: Math.min(offerQty, wantQty) };
}

export function tradePaid(paidAt: Date | string | null) {
  return paidAt != null;
}

export function paginationLimit(value: string | null | undefined) {
  if (value == null || value === "") return 50;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

export function encodeTradeCursor(id: string) {
  return Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
}

export function decodeTradeCursor(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof parsed?.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

type LedgerRole = { borrowerId: string; lenderId: string; status?: BorrowStatusValue };
type TradeRole = { buyerId: string; sellerId: string; paidAt: Date | string | null };

export function composeBorrowedSections<L extends LedgerRole, T extends TradeRole>(
  memberId: string,
  ledger: readonly L[],
  trades: readonly T[],
) {
  const unpaid = trades.filter((trade) => !tradePaid(trade.paidAt));
  const outstanding = ledger.filter((row) => row.status !== "returned");
  return {
    owes: {
      borrows: outstanding.filter((row) => row.borrowerId === memberId),
      trades: unpaid.filter((trade) => trade.buyerId === memberId),
    },
    owed: {
      borrows: outstanding.filter((row) => row.lenderId === memberId),
      trades: unpaid.filter((trade) => trade.sellerId === memberId),
    },
  };
}
