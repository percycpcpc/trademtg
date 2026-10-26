import { ApiError, cardDto } from "./server";
import type { ParsedLine } from "./import-parser";
export type ResolvedLine = ParsedLine & {
  scryfallId?: string;
  card?: ReturnType<typeof cardDto>;
};
const key = (x: any) => JSON.stringify(Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==="string"?v.toLocaleLowerCase("en-US"):v])));
const normalizedCardName = (name: string) =>
  name.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
export function importNamesMatch(parsedName: string, foundName: string) {
  return normalizedCardName(parsedName) === normalizedCardName(foundName);
}
async function lookup(identifiers: any[]) {
  const out = new Map<string, any>();
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75),
      r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "application/json",
          "User-Agent": "TradeMTG/1.0",
        },
        body: JSON.stringify({ identifiers: chunk }),
        cache: "no-store",
      });
    if (!r.ok)
      throw new ApiError(
        503,
        "CARD_LOOKUP_UNAVAILABLE",
        "Card lookup is unavailable",
      );
    const body = await r.json();
    for (const c of body.data ?? []) {
      out.set(key({ set: c.set, collector_number: c.collector_number }), c);
      out.set(key({ name: c.name, set: c.set }), c);
      out.set(key({ name: c.name }), c);
    }
  }
  return out;
}
export async function resolveImportLines(
  lines: ParsedLine[],
): Promise<ResolvedLine[]> {
  const result: ResolvedLine[] = lines.map((x) => ({ ...x }));
  const candidates = result
    .map((line, index) => ({ line, index }))
    .filter(
      (x) => x.line.state === "unresolved" && x.line.parsedName && x.line.qty,
    );
  for (const [pass, make] of [
    (l: ResolvedLine) =>
      l.setCode && l.collectorNo
        ? { set: l.setCode, collector_number: l.collectorNo }
        : null,
    (l: ResolvedLine) =>
      l.setCode ? { name: l.parsedName, set: l.setCode } : null,
    (l: ResolvedLine) => ({ name: l.parsedName }),
  ].entries()) {
    const pending = candidates.filter((x) => !result[x.index].scryfallId),
      unique = [
        ...new Map(
          pending
            .map((x) => {
              const id = make(x.line);
              return id ? [key(id), id] : null;
            })
            .filter(Boolean) as [string, any][],
        ).values(),
      ];
    if (!unique.length) continue;
    const found = await lookup(unique);
    for (const x of pending) {
      const id = make(x.line),
        card = id && found.get(key(id));
      if (
        card &&
        (pass !== 0 || importNamesMatch(x.line.parsedName!, card.name))
      ) {
        result[x.index].scryfallId = card.id;
        result[x.index].card = cardDto(card);
      }
    }
  }
  return result;
}
export function importTargets(
  current: Record<string, number>,
  lines: { scryfallId?: string | null; qty?: number | null; state: string }[],
) {
  const sums = new Map<string, number>();
  for (const l of lines)
    if (l.state === "unresolved" && l.scryfallId && l.qty)
      sums.set(l.scryfallId, (sums.get(l.scryfallId) ?? 0) + l.qty);
  return [...sums].map(([scryfallId, importQty]) => ({
    scryfallId,
    currentQty: current[scryfallId] ?? 0,
    importQty,
    targetQty: (current[scryfallId] ?? 0) + importQty,
  }));
}
export function validateImportCommit(
  items: { scryfallId: string; qty: number }[],
  lines: {
    id: string;
    resolvedScryfallId: string | null;
    qty: number | null;
    state: string;
  }[],
) {
  const targets = importTargets(
    {},
    lines.map((x) => ({
      scryfallId: x.resolvedScryfallId,
      qty: x.qty,
      state: x.state,
    })),
  );
  const byId = new Map(targets.map((x) => [x.scryfallId, x.importQty]));
  if (items.length !== byId.size || items.some((x) => !byId.has(x.scryfallId)))
    throw new ApiError(
      409,
      "IMPORT_LINES_CHANGED",
      "Import lines no longer match this commit",
    );
  return byId;
}
