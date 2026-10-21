import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;
export const palette = [
  "#E60023",
  "#650F26",
  "#173BDB",
  "#006B60",
  "#7435B8",
  "#B94300",
  "#237A24",
  "#B51C80",
  "#794426",
  "#315A73",
];
export const hash = (x: unknown) =>
  createHash("sha256")
    .update(typeof x === "string" ? x : JSON.stringify(x))
    .digest("hex");
export const money = (x: Prisma.Decimal | string) =>
  new Prisma.Decimal(x).toFixed(2);
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const fail = (e: unknown) => {
  const x =
    e instanceof ApiError
      ? e
      : new ApiError(500, "INTERNAL_ERROR", "Unexpected server error");
  return Response.json(
    { error: { code: x.code, message: x.message, details: x.details } },
    { status: x.status },
  );
};
export const validUuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    x,
  );
export function normalizeName(value: unknown) {
  if (typeof value !== "string")
    throw new ApiError(422, "INVALID_NAME", "Enter a member name");
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (
    name.length < 1 ||
    name.length > 40 ||
    /[\/\\\x00-\x1f]/.test(name) ||
    /^(api|_next|favicon\.ico|robots\.txt|sitemap\.xml)$/i.test(name)
  )
    throw new ApiError(
      422,
      "INVALID_NAME",
      "Name must be 1–40 characters and URL-safe",
    );
  return { name, nameKey: name.toLocaleLowerCase("en-US") };
}
export function common(b: any) {
  if (
    !validUuid(b?.actorMemberId) ||
    !validUuid(b?.requestId) ||
    !Number.isInteger(b?.expectedRevision)
  )
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "actorMemberId, requestId and expectedRevision are required",
    );
  return b as {
    actorMemberId: string;
    requestId: string;
    expectedRevision: number;
  };
}
export function parseQty(x: unknown, zero = false) {
  if (!Number.isInteger(x) || Number(x) < (zero ? 0 : 1) || Number(x) > 9999)
    throw new ApiError(
      422,
      "INVALID_QUANTITY",
      "Quantity must be an integer between 1 and 9999",
    );
  return Number(x);
}
export function parseMoney(x: unknown) {
  if (typeof x !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(x))
    throw new ApiError(
      422,
      "INVALID_PRICE",
      "Use a nonnegative decimal string with at most two decimals",
    );
  return new Prisma.Decimal(x);
}
const include = {
  wants: { include: { offers: { include: { offerer: true } } } },
  imports: { include: { lines: true } },
} as const;
export async function snapshot(memberId: string, actor?: string, tx: any = db) {
  const m = await tx.member.findUnique({ where: { id: memberId }, include });
  if (!m) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found");
  let cents = 0n,
    priced = 0,
    unpriced = 0,
    remaining = 0;
  const wants = m.wants.map((w: any) => {
    const offers = w.offers.map((o: any) => ({
      id: o.id,
      wantId: o.wantId,
      offerer: {
        id: o.offerer.id,
        name: o.offerer.name,
        color: o.offerer.color,
      },
      qty: o.qty,
      unitPriceHkd: money(o.unitPriceHkd),
      status: o.status,
      editable:
        o.offererId === actor &&
        o.status === "open" &&
        !w.offers.some((a: any) => a.status === "accepted"),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }));
    const accepted = offers.find((o: any) => o.status === "accepted");
    const opens = offers
      .filter((o: any) => o.status === "open")
      .sort(
        (a: any, b: any) =>
          Number(new Prisma.Decimal(a.unitPriceHkd).minus(b.unitPriceHkd)) ||
          b.qty - a.qty ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    const chosen = accepted ?? opens[0];
    if (chosen) {
      cents += BigInt(
        new Prisma.Decimal(chosen.unitPriceHkd)
          .times(chosen.qty)
          .times(100)
          .toFixed(0),
      );
      priced++;
    } else unpriced++;
    const covered = accepted?.qty ?? 0;
    remaining += Math.max(0, w.qty - covered);
    return {
      id: w.id,
      scryfallId: w.scryfallId,
      cardName: w.cardName,
      imageUrl: w.imageUrl,
      setCode: w.setCode,
      collectorNo: w.collectorNo,
      rarity: w.rarity,
      colors: w.colors,
      qty: w.qty,
      offers,
      acceptedOfferId: accepted?.id ?? null,
      coveredQty: covered,
      remainingQty: Math.max(0, w.qty - covered),
    };
  });
  return {
    member: { id: m.id, name: m.name, color: m.color, revision: m.revision },
    wants,
    unresolvedImports: m.imports.flatMap((b: any) =>
      b.lines
        .filter((l: any) => l.state === "unresolved")
        .map((l: any) => ({
          id: l.id,
          batchId: b.id,
          lineNo: l.lineNo,
          rawText: l.rawText,
          parsedName: l.parsedName,
          qty: l.qty,
          reason: l.reason,
        })),
    ),
    total: {
      amountHkd: `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`,
      pricedCards: priced,
      unpricedCards: unpriced,
      remainingCopies: remaining,
    },
  };
}
export async function cardById(id: string) {
  const r = await fetch(
    `https://api.scryfall.com/cards/${encodeURIComponent(id)}`,
    {
      headers: { Accept: "application/json", "User-Agent": "TradeMTG/1.0" },
      cache: "no-store",
    },
  );
  if (!r.ok)
    throw new ApiError(
      503,
      "CARD_LOOKUP_UNAVAILABLE",
      "Card lookup is unavailable",
    );
  return cardDto(await r.json());
}
export function cardDto(c: any) {
  return {
    scryfallId: c.id,
    cardName: c.name,
    imageUrl:
      c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null,
    setCode: c.set,
    collectorNo: c.collector_number,
    rarity: c.rarity,
    colors: c.colors?.length
      ? c.colors
      : [...new Set((c.card_faces ?? []).flatMap((f: any) => f.colors ?? []))],
  };
}
export async function lockMember(tx: any, id: string) {
  await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${id}::uuid FOR UPDATE`;
}
const retryable = (e: any) =>
  e?.code === "P2034" || /deadlock/i.test(String(e?.message ?? ""));
export async function serializable<T>(work: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await work();
    } catch (e) {
      if (!retryable(e)) throw e;
      if (attempt === 2)
        throw new ApiError(
          409,
          "RETRY_CONFLICT",
          "The list is busy; retry your change",
        );
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          15 + Math.floor(Math.random() * 35) * (attempt + 1),
        ),
      );
    }
  }
  throw new ApiError(
    409,
    "RETRY_CONFLICT",
    "The list is busy; retry your change",
  );
}
export async function memberMutation(
  owner: string,
  b: any,
  fn: (tx: any) => Promise<any>,
) {
  common(b);
  return serializable(() =>
    db.$transaction(
      async (tx) => {
        await lockMember(tx, owner);
        const m = await tx.member.findUnique({ where: { id: owner } });
        if (!m) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found");
        const old = await tx.mutationReceipt.findUnique({
          where: {
            memberId_requestId: { memberId: owner, requestId: b.requestId },
          },
        });
        const payloadHash = hash(b);
        if (old) {
          if (old.payloadHash !== payloadHash)
            throw new ApiError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "Request ID was reused with a different payload",
            );
          return old.response;
        }
        if (m.revision !== b.expectedRevision)
          throw new ApiError(
            409,
            "STALE_LIST",
            "List changed; refresh and retry",
            { revision: m.revision },
          );
        const result = await fn(tx);
        await tx.member.update({
          where: { id: owner },
          data: { revision: { increment: 1 } },
        });
        const list = await snapshot(owner, b.actorMemberId, tx);
        const value = { ...result, list, revision: list.member.revision };
        await tx.mutationReceipt.create({
          data: {
            memberId: owner,
            requestId: b.requestId,
            payloadHash,
            response: value,
          },
        });
        return value;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
