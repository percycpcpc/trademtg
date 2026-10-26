export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import {
  ApiError,
  cardById,
  cardDto,
  common,
  db,
  fail,
  hash,
  lockMember,
  memberMutation,
  money,
  normalizeName,
  palette,
  parseMoney,
  parseFinish,
  parseBorrowBody,
  parseBorrowStatus,
  parseDoneBody,
  parseFoilPref,
  parseQty,
  parsePaidBody,
  parseTargetPrice,
  serializable,
  snapshot,
  validUuid,
} from "../../../lib/server";
import {
  decodeTradeCursor,
  encodeTradeCursor,
  paginationLimit,
  tradePaid,
  tradeSnapshotQuantities,
} from "../../../lib/trades-borrowed";
import { parseImport } from "../../../lib/import-parser";
import {
  importTargets,
  resolveImportLines,
  validateImportCommit,
} from "../../../lib/import-service";
const json = async (r: NextRequest) => {
  try {
    return await r.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Malformed JSON");
  }
};
const memberTx = memberMutation;
const party = (member: any) => ({
  id: member.id,
  name: member.name,
  color: member.color,
});
const tradeDto = (trade: any, memberId: string) => ({
  id: trade.id,
  offerId: trade.offerId,
  sourceOfferId: trade.sourceOfferId,
  buyerId: trade.buyerId,
  sellerId: trade.sellerId,
  scryfallId: trade.scryfallId,
  cardName: trade.cardName,
  imageUrl: trade.imageUrl,
  setCode: trade.setCode,
  collectorNo: trade.collectorNo,
  rarity: trade.rarity,
  finish: trade.finish,
  qty: trade.qty,
  deductedQty: trade.deductedQty,
  unitPriceHkd: money(trade.unitPriceHkd),
  paid: tradePaid(trade.paidAt),
  paidAt: trade.paidAt?.toISOString() ?? null,
  finishedAt: trade.finishedAt.toISOString(),
  counterparty: party(trade.buyerId === memberId ? trade.seller : trade.buyer),
});
const borrowDto = (borrow: any, memberId: string) => ({
  id: borrow.id,
  scryfallId: borrow.scryfallId,
  cardName: borrow.cardName,
  imageUrl: borrow.imageUrl,
  qty: borrow.qty,
  borrowerId: borrow.borrowerId,
  lenderId: borrow.lenderId,
  status: borrow.status,
  createdAt: borrow.createdAt.toISOString(),
  returnedAt: borrow.returnedAt?.toISOString() ?? null,
  otherParty: party(borrow.borrowerId === memberId ? borrow.lender : borrow.borrower),
});
async function importReport(
  memberId: string,
  batch: any,
  cards = new Map<string, ReturnType<typeof cardDto>>(),
) {
  const wants = await db.want.findMany({
    where: { memberId },
    select: { scryfallId: true, qty: true },
  });
  const current = Object.fromEntries(wants.map((x) => [x.scryfallId, x.qty]));
  const lines = batch.lines.map((line: any) => ({
    ...line,
    scryfallId: line.resolvedScryfallId,
  }));
  const proposed = importTargets(current, lines);
  // Initial staging already resolved canonical metadata. Replayed reviews fetch
  // missing printings in collection batches rather than one request per card.
  const missing = proposed.filter((item) => !cards.has(item.scryfallId));
  for (let offset = 0; offset < missing.length; offset += 75) {
    if (offset) await new Promise((resolve) => setTimeout(resolve, 110));
    const response = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
        "User-Agent": "TradeMTG/1.0",
      },
      body: JSON.stringify({
        identifiers: missing
          .slice(offset, offset + 75)
          .map((item) => ({ id: item.scryfallId })),
      }),
      cache: "no-store",
    });
    if (!response.ok)
      throw new ApiError(
        503,
        "CARD_LOOKUP_UNAVAILABLE",
        "Couldn?t check these cards. Try again.",
      );
    for (const card of (await response.json()).data ?? [])
      cards.set(card.id, cardDto(card));
  }
  if (proposed.some((item) => !cards.has(item.scryfallId)))
    throw new ApiError(
      503,
      "CARD_LOOKUP_UNAVAILABLE",
      "Couldn?t check these cards. Try again.",
    );
  return {
    batchId: batch.id,
    baseRevision: (
      await db.member.findUniqueOrThrow({ where: { id: memberId } })
    ).revision,
    lines,
    proposedItems: proposed.map((item) => ({
      ...item,
      card: cards.get(item.scryfallId)!,
    })),
  };
}
export async function GET(
  r: NextRequest,
  c: { params: Promise<{ path: string[] }> },
) {
  try {
    const p = (await c.params).path;
    if (p.join("/") === "members")
      return Response.json({
        members: await db.member.findMany({
          select: { id: true, name: true, color: true, revision: true },
          orderBy: { name: "asc" },
        }),
      });
    if (p.join("/") === "health") {
      await db.$queryRaw`SELECT 1`;
      return Response.json({ status: "ok" });
    }
    if (p[0] === "members" && p.length === 2) {
      if (!validUuid(p[1]))
        throw new ApiError(400, "INVALID_ID", "Invalid member ID");
      return Response.json(
        await snapshot(
          p[1],
          r.nextUrl.searchParams.get("actorMemberId") ?? undefined,
        ),
      );
    }
    if (p[0] === "members" && p[2] === "trades" && p.length === 3) {
      if (!validUuid(p[1]))
        throw new ApiError(400, "INVALID_ID", "Invalid member ID");
      const member = await db.member.findUnique({ where: { id: p[1] }, select: { id: true } });
      if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found");
      const limit = paginationLimit(r.nextUrl.searchParams.get("limit"));
      const rawCursor = r.nextUrl.searchParams.get("cursor");
      const cursor = decodeTradeCursor(rawCursor);
      if (rawCursor && (!cursor || !validUuid(cursor)))
        throw new ApiError(400, "INVALID_CURSOR", "Invalid trade cursor");
      const rows = await db.trade.findMany({
        where: { OR: [{ buyerId: p[1] }, { sellerId: p[1] }] },
        include: { buyer: true, seller: true },
        orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return Response.json({
        trades: page.map((trade) => tradeDto(trade, p[1])),
        nextCursor: hasMore ? encodeTradeCursor(page.at(-1)!.id) : null,
      });
    }
    if (p[0] === "members" && p[2] === "borrows" && p.length === 3) {
      if (!validUuid(p[1]))
        throw new ApiError(400, "INVALID_ID", "Invalid member ID");
      const member = await db.member.findUnique({ where: { id: p[1] }, select: { id: true } });
      if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found");
      const rows = await db.borrow.findMany({
        where: { OR: [{ borrowerId: p[1] }, { lenderId: p[1] }] },
        include: { borrower: true, lender: true },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      return Response.json({ borrows: rows.map((borrow) => borrowDto(borrow, p[1])) });
    }
    if (p[0] === "members" && p[2] === "export") {
      const list = await snapshot(p[1]);
      const body =
        list.wants
          .map(
            (w: any) => `${w.qty} ${w.cardName} (${w.setCode.toUpperCase()})`,
          )
          .join("\n") +
        `\n# ${list.unresolvedImports.length} unresolved line(s) excluded\n`;
      return new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${list.member.name.replace(/[^a-z0-9_-]/gi, "_")}-wants.txt"`,
        },
      });
    }
    if (p[0] === "members" && p[2] === "imports" && p[3]) {
      const batch = await db.importBatch.findFirst({
        where: { id: p[3], memberId: p[1] },
        include: { lines: true },
      });
      if (!batch)
        throw new ApiError(404, "IMPORT_NOT_FOUND", "Import not found");
      return Response.json(await importReport(p[1], batch));
    }
    if (p.join("/") === "cards/autocomplete") {
      const q = r.nextUrl.searchParams.get("q") ?? "";
      const x = await fetch(
        `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`,
        { headers: { "User-Agent": "TradeMTG/1.0" } },
      );
      if (!x.ok)
        throw new ApiError(
          503,
          "CARD_LOOKUP_UNAVAILABLE",
          "Autocomplete unavailable",
        );
      return Response.json({ names: (await x.json()).data });
    }
    if (p.join("/") === "cards/resolve") {
      const name = r.nextUrl.searchParams.get("name");
      if (!name) throw new ApiError(422, "INVALID_NAME", "Card name required");
      const set = r.nextUrl.searchParams.get("set");
      const x = await fetch(
        `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}${set ? `&set=${encodeURIComponent(set)}` : ""}`,
        { headers: { "User-Agent": "TradeMTG/1.0" } },
      );
      if (!x.ok)
        throw new ApiError(
          x.status === 404 ? 422 : 503,
          x.status === 404 ? "CARD_NOT_FOUND" : "CARD_LOOKUP_UNAVAILABLE",
          "Card could not be resolved",
        );
      return Response.json({ card: cardDto(await x.json()) });
    }
    throw new ApiError(404, "NOT_FOUND", "Route not found");
  } catch (e) {
    return fail(e);
  }
}
export async function POST(
  r: NextRequest,
  c: { params: Promise<{ path: string[] }> },
) {
  try {
    const p = (await c.params).path,
      b = await json(r);
    if (p.join("/") === "members") {
      const n = normalizeName(b.name),
        all = await db.member.findMany({ select: { color: true } });
      const counts = palette.map(
          (x) => all.filter((m) => m.color === x).length,
        ),
        color = palette[counts.indexOf(Math.min(...counts))];
      try {
        return Response.json(
          {
            member: await db.member.create({
              data: { ...n, color },
              select: { id: true, name: true, color: true, revision: true },
            }),
          },
          { status: 201 },
        );
      } catch (e: any) {
        if (e.code === "P2002") {
          const existing = await db.member.findUnique({
            where: { nameKey: n.nameKey },
          });
          throw new ApiError(409, "NAME_EXISTS", "That member already exists", {
            member: existing,
          });
        }
        throw e;
      }
    }
    if (p.join("/") === "borrows") {
      common(b);
      const input = parseBorrowBody(b);
      const card = await cardById(input.scryfallId);
      return Response.json(
        await memberTx(input.borrowerId, b, async (tx) => {
          const borrow = await tx.borrow.create({
            data: {
              borrowerId: input.borrowerId,
              lenderId: input.lenderId,
              scryfallId: input.scryfallId,
              cardName: card.cardName,
              imageUrl: card.imageUrl,
              qty: input.qty,
            },
            include: { borrower: true, lender: true },
          });
          return { borrow: borrowDto(borrow, input.borrowerId) };
        }),
        { status: 201 },
      );
    }
    if (p[0] === "members" && p[2] === "imports") {
      if (b.actorMemberId !== p[1])
        throw new ApiError(
          403,
          "OWNER_REQUIRED",
          "Only the list owner can import",
        );
      if (!validUuid(b.requestId) || typeof b.text !== "string")
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "requestId and text required",
        );
      const old = await db.importBatch.findUnique({
        where: {
          memberId_requestId: { memberId: p[1], requestId: b.requestId },
        },
        include: { lines: true },
      });
      if (old) {
        if (old.contentHash !== hash(b.text))
          throw new ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Request ID was reused with different import text",
          );
        return Response.json(await importReport(p[1], old));
      }
      const contentHash = hash(b.text);
      const duplicate = await db.importBatch.findFirst({
        where: { memberId: p[1], contentHash },
      });
      if (duplicate && !b.importAgain)
        return Response.json(
          {
            duplicateWarning: true,
            message:
              "This list was imported before; importing again adds quantities",
          },
          { status: 409 },
        );
      const lines = await resolveImportLines(parseImport(b.text));
      const batch = await serializable(() =>
        db.$transaction(async (tx) => {
          await lockMember(tx, p[1]);
          const x = await tx.importBatch.create({
            data: {
              memberId: p[1],
              requestId: b.requestId,
              contentHash,
              lines: {
                create: lines.map((l) => ({
                  lineNo: l.lineNo,
                  rawText: l.rawText,
                  parsedName: l.parsedName,
                  qty: l.qty,
                  setCode: l.setCode,
                  collectorNo: l.collectorNo,
                  reason: l.scryfallId
                    ? null
                    : (l.reason ??
                      (l.parsedName ? "No exact Scryfall match" : null)),
                  state: l.state,
                  resolvedScryfallId: l.scryfallId,
                })),
              },
            },
            include: { lines: true },
          });
          await tx.member.update({
            where: { id: p[1] },
            data: { revision: { increment: 1 } },
          });
          return x;
        }),
      );
      return Response.json(
        await importReport(
          p[1],
          batch,
          new Map(
            lines.flatMap((line) =>
              line.card && line.scryfallId
                ? [[line.scryfallId, line.card] as const]
                : [],
            ),
          ),
        ),
        { status: 201 },
      );
    }
    if (p[0] === "wants" && p[2] === "offers") {
      const want = await db.want.findUnique({
        where: { id: p[1] },
        include: { offers: true },
      });
      if (!want) throw new ApiError(404, "WANT_NOT_FOUND", "Want not found");
      if (b.actorMemberId !== b.offererId)
        throw new ApiError(
          403,
          "OFFERER_REQUIRED",
          "Acting member must be offerer",
        );
      if (b.offererId === want.memberId)
        throw new ApiError(
          400,
          "SELF_OFFER_NOT_ALLOWED",
          "You cannot make an offer on your own want",
        );
      return Response.json(
        await memberTx(want.memberId, b, async (tx) => {
          if (want.offers.some((o) => o.status === "accepted"))
            throw new ApiError(
              409,
              "WANT_HAS_ACCEPTED_OFFER",
              "Offers are frozen",
            );
          const qty = parseQty(b.qty);
          if (qty > want.qty)
            throw new ApiError(
              422,
              "OFFER_QTY_EXCEEDS_WANT",
              "Offer exceeds wanted quantity",
            );
          const price = parseMoney(b.unitPriceHkd);
          const finish = parseFinish(b.finish ?? "non-foil");
          const existing = await tx.offer.findFirst({
            where: {
              wantId: want.id,
              offererId: b.offererId,
              status: { not: "done" },
            },
          });
          if (existing && existing.status !== "withdrawn")
            throw new ApiError(409, "OFFER_EXISTS", "Offer already exists");
          const offer = existing
            ? await tx.offer.update({
                where: { id: existing.id },
                data: { qty, unitPriceHkd: price, finish, status: "open" },
              })
            : await tx.offer.create({
                data: {
                  wantId: want.id,
                  offererId: b.offererId,
                  qty,
                  unitPriceHkd: price,
                  finish,
                },
              });
          return {
            offer: { ...offer, unitPriceHkd: money(offer.unitPriceHkd) },
          };
        }),
        { status: 201 },
      );
    }
    if (p[0] === "offers" && p[2] === "done" && p.length === 3) {
      common(b);
      const { paid } = parseDoneBody(b);
      const foundOffer = await db.offer.findUnique({
        where: { id: p[1] },
        include: { want: true },
      });
      const historical = foundOffer
        ? null
        : await db.trade.findFirst({ where: { sourceOfferId: p[1] } });
      const buyerId = foundOffer?.want.memberId ?? historical?.buyerId;
      if (!buyerId) throw new ApiError(404, "OFFER_NOT_FOUND", "Offer not found");
      if (b.actorMemberId !== buyerId && b.actorMemberId !== (foundOffer?.offererId ?? historical?.sellerId))
        throw new ApiError(403, "TRADE_PARTY_REQUIRED", "Only a trade party can finish it");
      return Response.json(
        await memberTx(buyerId, b, async (tx) => {
          const offer = await tx.offer.findUnique({ where: { id: p[1] } });
          if (!offer) throw new ApiError(409, "OFFER_ALREADY_FINISHED", "Offer was already finished");
          if (offer.status !== "accepted")
            throw new ApiError(409, "OFFER_NOT_ACCEPTED", "Only an accepted offer can be finished");
          const want = await tx.want.findUnique({ where: { id: offer.wantId } });
          if (!want) throw new ApiError(409, "WANT_NOT_FOUND", "Want no longer exists");
          if (offer.offererId === want.memberId)
            throw new ApiError(400, "SELF_TRADE_NOT_ALLOWED", "You cannot finish a trade with yourself");
          const quantities = tradeSnapshotQuantities(offer.qty, want.qty);
          await tx.offer.update({ where: { id: offer.id }, data: { status: "done" } });
          const trade = await tx.trade.create({
            data: {
              offerId: offer.id,
              sourceOfferId: offer.id,
              buyerId: want.memberId,
              sellerId: offer.offererId,
              scryfallId: want.scryfallId,
              cardName: want.cardName,
              imageUrl: want.imageUrl,
              setCode: want.setCode,
              collectorNo: want.collectorNo,
              rarity: want.rarity,
              finish: offer.finish,
              ...quantities,
              unitPriceHkd: offer.unitPriceHkd,
              paidAt: paid ? new Date() : null,
            },
            include: { buyer: true, seller: true },
          });
          const remaining = want.qty - quantities.deductedQty;
          if (remaining <= 0) await tx.want.delete({ where: { id: want.id } });
          else await tx.want.update({ where: { id: want.id }, data: { qty: remaining } });
          return { trade: tradeDto(trade, buyerId) };
        }),
      );
    }
    if (p[0] === "offers" && p[2] === "accept") {
      const offer = await db.offer.findUnique({
        where: { id: p[1] },
        include: { want: true },
      });
      if (!offer) throw new ApiError(404, "OFFER_NOT_FOUND", "Offer not found");
      if (b.actorMemberId !== offer.want.memberId)
        throw new ApiError(403, "OWNER_REQUIRED", "Only owner can accept");
      return Response.json(
        await memberTx(offer.want.memberId, b, async (tx) => {
          const offers = await tx.offer.findMany({
              where: { wantId: offer.wantId },
            }),
            current = offers.find((o: any) => o.status === "accepted");
          if (offer.status === "withdrawn")
            throw new ApiError(409, "OFFER_WITHDRAWN", "Offer was withdrawn");
          if (offer.status === "done")
            throw new ApiError(409, "OFFER_ALREADY_FINISHED", "Offer was already finished");
          if (
            (current?.id ?? null) !== (b.expectedAcceptedOfferId ?? null) &&
            current?.id !== offer.id
          )
            throw new ApiError(
              409,
              "ACCEPTANCE_CHANGED",
              "Accepted offer changed",
              { acceptedOfferId: current?.id ?? null },
            );
          if (current && current.id !== offer.id)
            await tx.offer.update({
              where: { id: current.id },
              data: { status: "open" },
            });
          await tx.offer.update({
            where: { id: offer.id },
            data: { status: "accepted" },
          });
          return {};
        }),
      );
    }
    throw new ApiError(404, "NOT_FOUND", "Route not found");
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(
  r: NextRequest,
  c: { params: Promise<{ path: string[] }> },
) {
  try {
    const p = (await c.params).path,
      b = await json(r);
    if (p[0] === "members" && p[2] === "wants") {
      if (b.actorMemberId !== p[1] && !b.items?.every((x: any) => x.qty === 0))
        throw new ApiError(403, "OWNER_REQUIRED", "Only owner may add wants");
      const seen = new Set<string>();
      for (const x of b.items ?? []) {
        if (!validUuid(x.scryfallId) || seen.has(x.scryfallId))
          throw new ApiError(
            422,
            "INVALID_ITEMS",
            "Invalid or duplicate card ID",
          );
        seen.add(x.scryfallId);
        parseQty(x.qty, true);
        if (x.foilPref !== undefined) parseFoilPref(x.foilPref);
        if (x.targetPriceHkd !== undefined) parseTargetPrice(x.targetPriceHkd);
      }
      const cards = await Promise.all(
        (b.items ?? [])
          .filter((x: any) => x.qty > 0)
          .map((x: any) => cardById(x.scryfallId)),
      );
      return Response.json(
        await memberTx(p[1], b, async (tx) => {
          let importLines: any[] = [];
          if (b.importBatchId || b.resolveLineIds?.length) {
            if (
              !validUuid(b.importBatchId) ||
              !Array.isArray(b.resolveLineIds) ||
              !b.resolveLineIds.length
            )
              throw new ApiError(
                422,
                "INVALID_IMPORT_COMMIT",
                "Batch and contributing lines are required",
              );
            importLines = await tx.importLine.findMany({
              where: {
                id: { in: b.resolveLineIds },
                batchId: b.importBatchId,
                batch: { memberId: p[1] },
              },
            });
            if (
              importLines.length !== b.resolveLineIds.length ||
              importLines.some(
                (x: any) =>
                  x.state !== "unresolved" || !x.resolvedScryfallId || !x.qty,
              )
            )
              throw new ApiError(
                409,
                "IMPORT_LINES_CHANGED",
                "Import lines were already consumed or changed",
              );
            const contributions = validateImportCommit(b.items, importLines);
            const existing = await tx.want.findMany({
              where: {
                memberId: p[1],
                scryfallId: { in: [...contributions.keys()] },
              },
              select: { scryfallId: true, qty: true },
            });
            const current = new Map<string, number>(
              existing.map((x: any) => [x.scryfallId, x.qty]),
            );
            for (const x of b.items) {
              const target =
                (current.get(x.scryfallId) ?? 0) +
                contributions.get(x.scryfallId)!;
              if (x.qty !== target)
                throw new ApiError(
                  409,
                  "IMPORT_TARGET_CHANGED",
                  "Import target is stale",
                  { scryfallId: x.scryfallId, targetQty: target },
                );
            }
          }
          for (const x of b.items) {
            if (x.qty === 0)
              await tx.want.deleteMany({
                where: { memberId: p[1], scryfallId: x.scryfallId },
              });
            else {
              const card = cards.find((c) => c.scryfallId === x.scryfallId)!;
              const active = await tx.offer.findMany({
                where: {
                  want: { memberId: p[1], scryfallId: x.scryfallId },
                  status: { in: ["open", "accepted"] },
                  qty: { gt: x.qty },
                },
              });
              if (active.length)
                throw new ApiError(
                  409,
                  "OFFER_QTY_CONFLICT",
                  "Offers exceed new quantity",
                );
              await tx.want.upsert({
                where: {
                  memberId_scryfallId: {
                    memberId: p[1],
                    scryfallId: x.scryfallId,
                  },
                },
                create: {
                  memberId: p[1],
                  ...card,
                  qty: x.qty,
                  ...(x.foilPref === undefined ? {} : { foilPref: x.foilPref }),
                  ...(x.targetPriceHkd === undefined ? {} : { targetPriceHkd: parseTargetPrice(x.targetPriceHkd) }),
                },
                update: {
                  ...card,
                  qty: x.qty,
                  ...(x.foilPref === undefined ? {} : { foilPref: x.foilPref }),
                  ...(x.targetPriceHkd === undefined ? {} : { targetPriceHkd: parseTargetPrice(x.targetPriceHkd) }),
                },
              });
            }
          }
          if (importLines.length)
            await tx.importLine.updateMany({
              where: { id: { in: b.resolveLineIds } },
              data: { state: "resolved" },
            });
          return { applied: b.items, resolvedLineIds: b.resolveLineIds ?? [] };
        }),
      );
    }
    if (p[0] === "offers") {
      const offer = await db.offer.findUnique({
        where: { id: p[1] },
        include: { want: { include: { offers: true } } },
      });
      if (!offer) throw new ApiError(404, "OFFER_NOT_FOUND", "Offer not found");
      if (b.actorMemberId !== offer.offererId)
        throw new ApiError(403, "OFFERER_REQUIRED", "Only offerer may edit");
      return Response.json(
        await memberTx(offer.want.memberId, b, async (tx) => {
          if (offer.status === "accepted" || offer.status === "done")
            throw new ApiError(
              409,
              "ACCEPTED_OFFER_IMMUTABLE",
              "Accepted or finished offer is immutable",
            );
          if (offer.want.offers.some((o) => o.status === "accepted"))
            throw new ApiError(
              409,
              "WANT_HAS_ACCEPTED_OFFER",
              "Offers are frozen",
            );
          const qty = parseQty(b.qty);
          if (qty > offer.want.qty)
            throw new ApiError(
              422,
              "OFFER_QTY_EXCEEDS_WANT",
              "Offer exceeds want",
            );
          const o = await tx.offer.update({
            where: { id: offer.id },
            data: { qty, unitPriceHkd: parseMoney(b.unitPriceHkd), finish: parseFinish(b.finish ?? "non-foil") },
          });
          return { offer: { ...o, unitPriceHkd: money(o.unitPriceHkd) } };
        }),
      );
    }
    throw new ApiError(404, "NOT_FOUND", "Route not found");
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(
  r: NextRequest,
  c: { params: Promise<{ path: string[] }> },
) {
  try {
    const p = (await c.params).path,
      b = await json(r);
    if (p[0] === "offers" && p[2] === "paid" && p.length === 3) {
      common(b);
      const { paid } = parsePaidBody(b);
      const foundOffer = await db.offer.findUnique({
        where: { id: p[1] },
        include: { want: true },
      });
      const foundTrade = await db.trade.findFirst({
        where: { OR: [{ offerId: p[1] }, { sourceOfferId: p[1] }] },
      });
      const buyerId = foundTrade?.buyerId ?? foundOffer?.want.memberId;
      const sellerId = foundTrade?.sellerId ?? foundOffer?.offererId;
      if (!buyerId || !sellerId)
        throw new ApiError(404, "TRADE_NOT_FOUND", "Finished trade not found");
      if (b.actorMemberId !== buyerId && b.actorMemberId !== sellerId)
        throw new ApiError(403, "TRADE_PARTY_REQUIRED", "Only a trade party can update payment");
      return Response.json(
        await memberTx(buyerId, b, async (tx) => {
          const offer = await tx.offer.findUnique({ where: { id: p[1] } });
          if (offer && offer.status !== "done")
            throw new ApiError(409, "OFFER_NOT_DONE", "Only a finished offer can update payment");
          const trade = await tx.trade.findFirst({
            where: { OR: [{ offerId: p[1] }, { sourceOfferId: p[1] }] },
          });
          if (!trade)
            throw new ApiError(404, "TRADE_NOT_FOUND", "Finished trade not found");
          const updated = await tx.trade.update({
            where: { id: trade.id },
            data: { paidAt: paid ? new Date() : null },
            include: { buyer: true, seller: true },
          });
          return { trade: tradeDto(updated, buyerId) };
        }),
      );
    }
    if (p[0] === "borrows" && p.length === 2) {
      common(b);
      const status = parseBorrowStatus(b.status);
      const found = await db.borrow.findUnique({ where: { id: p[1] } });
      if (!found) throw new ApiError(404, "BORROW_NOT_FOUND", "Borrow entry not found");
      return Response.json(
        await memberTx(found.borrowerId, b, async (tx) => {
          const borrow = await tx.borrow.update({
            where: { id: found.id },
            data: { status, returnedAt: status === "returned" ? new Date() : null },
            include: { borrower: true, lender: true },
          });
          return { borrow: borrowDto(borrow, found.borrowerId) };
        }),
      );
    }
    if (p[0] !== "offers" || p.length !== 2)
      throw new ApiError(404, "NOT_FOUND", "Route not found");
    const offer = await db.offer.findUnique({
      where: { id: p[1] },
      include: { want: { include: { offers: true } } },
    });
    if (!offer) throw new ApiError(404, "OFFER_NOT_FOUND", "Offer not found");
    if (b.actorMemberId !== offer.offererId)
      throw new ApiError(403, "OFFERER_REQUIRED", "Only offerer may edit");
    return Response.json(
      await memberTx(offer.want.memberId, b, async (tx) => {
        if (offer.status === "accepted" || offer.status === "done")
          throw new ApiError(
            409,
            "ACCEPTED_OFFER_IMMUTABLE",
            "Accepted or finished offer is immutable",
          );
        if (offer.want.offers.some((o) => o.status === "accepted"))
          throw new ApiError(
            409,
            "WANT_HAS_ACCEPTED_OFFER",
            "Offers are frozen",
          );
        if (b.status === "withdrawn")
          return {
            offer: await tx.offer.update({
              where: { id: offer.id },
              data: { status: "withdrawn" },
            }),
          };
        if (b.status !== undefined)
          throw new ApiError(422, "INVALID_STATUS", "Only withdrawal is supported");
        const qty = parseQty(b.qty);
        if (qty > offer.want.qty)
          throw new ApiError(422, "OFFER_QTY_EXCEEDS_WANT", "Offer exceeds want");
        const updated = await tx.offer.update({
          where: { id: offer.id },
          data: {
            qty,
            unitPriceHkd: parseMoney(b.unitPriceHkd),
            finish: parseFinish(b.finish ?? "non-foil"),
          },
        });
        return { offer: { ...updated, unitPriceHkd: money(updated.unitPriceHkd) } };
      }),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(
  r: NextRequest,
  c: { params: Promise<{ path: string[] }> },
) {
  try {
    const p = (await c.params).path,
      b = await json(r);
    if (p[0] === "wants") {
      const w = await db.want.findUnique({ where: { id: p[1] } });
      if (!w) throw new ApiError(404, "WANT_NOT_FOUND", "Want not found");
      return Response.json(
        await memberTx(w.memberId, b, async (tx) => {
          await tx.want.delete({ where: { id: w.id } });
          return { deletedId: w.id };
        }),
      );
    }
    if (p[0] === "offers") {
      const o = await db.offer.findUnique({
        where: { id: p[1] },
        include: { want: true },
      });
      if (!o) throw new ApiError(404, "OFFER_NOT_FOUND", "Offer not found");
      return Response.json(
        await memberTx(o.want.memberId, b, async (tx) => {
          await tx.offer.delete({ where: { id: o.id } });
          return { deletedId: o.id };
        }),
      );
    }
    if (p[0] === "import-lines") {
      const l = await db.importLine.findUnique({
        where: { id: p[1] },
        include: { batch: true },
      });
      if (!l)
        throw new ApiError(404, "LINE_NOT_FOUND", "Import line not found");
      return Response.json(
        await memberTx(l.batch.memberId, b, async (tx) => {
          await tx.importLine.update({
            where: { id: l.id },
            data: { state: "ignored" },
          });
          return { deletedId: l.id };
        }),
      );
    }
    if (p[0] === "members") {
      common(b);
      const target = await db.member.findUnique({
        where: { id: p[1] },
        include: { offers: { include: { want: true } } },
      });
      if (!target)
        throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found");
      if (target.revision !== b.expectedRevision)
        throw new ApiError(409, "STALE_LIST", "List changed");
      const affected = [
        ...new Set(
          target.offers
            .map((o) => o.want.memberId)
            .filter((x) => x !== target.id),
        ),
      ].sort();
      try {
        await db.$transaction(async (tx) => {
          for (const id of affected) {
            await lockMember(tx, id);
            await tx.member.update({
              where: { id },
              data: { revision: { increment: 1 } },
            });
          }
          await tx.member.delete({ where: { id: target.id } });
        });
      } catch (e: any) {
        if (e?.code === "P2003" || e?.code === "P2014")
          throw new ApiError(
            409,
            "MEMBER_HISTORY_EXISTS",
            "This member cannot be deleted because trade or borrowing history references them",
          );
        throw e;
      }
      return Response.json({
        deletedId: target.id,
        affectedMemberIds: affected,
      });
    }
    throw new ApiError(404, "NOT_FOUND", "Route not found");
  } catch (e) {
    return fail(e);
  }
}
