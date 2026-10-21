export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import {
  db,
  fail,
  ApiError,
  cardById,
  memberMutation,
  parseQty,
} from "../../../../lib/server";
export async function PUT(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const b = await r.json(),
      id = (await params).id,
      line = await db.importLine.findUnique({
        where: { id },
        include: { batch: true },
      });
    if (!line)
      throw new ApiError(404, "LINE_NOT_FOUND", "Import line not found");
    if (b.actorMemberId !== line.batch.memberId)
      throw new ApiError(
        403,
        "OWNER_REQUIRED",
        "Only owner can repair imports",
      );
    const qty = parseQty(b.absoluteQty),
      card = await cardById(b.scryfallId);
    const response = await memberMutation(
      line.batch.memberId,
      b,
      async (tx) => {
        const fresh = await tx.importLine.findUniqueOrThrow({ where: { id } });
        if (fresh.state !== "unresolved")
          throw new ApiError(
            409,
            "IMPORT_LINE_CONSUMED",
            "Line was already consumed",
          );
        await tx.want.upsert({
          where: {
            memberId_scryfallId: {
              memberId: line.batch.memberId,
              scryfallId: card.scryfallId,
            },
          },
          create: { memberId: line.batch.memberId, ...card, qty },
          update: { ...card, qty },
        });
        await tx.importLine.update({
          where: { id },
          data: { state: "resolved", resolvedScryfallId: card.scryfallId },
        });
        return {
          line: { id, state: "resolved", resolvedScryfallId: card.scryfallId },
        };
      },
    );
    return Response.json(response);
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const b = await r.json(),
      id = (await params).id,
      line = await db.importLine.findUnique({
        where: { id },
        include: { batch: true },
      });
    if (!line)
      throw new ApiError(404, "LINE_NOT_FOUND", "Import line not found");
    const response = await memberMutation(
      line.batch.memberId,
      b,
      async (tx) => {
        await tx.importLine.update({
          where: { id },
          data: { state: "ignored" },
        });
        return { deletedId: id };
      },
    );
    return Response.json(response);
  } catch (e) {
    return fail(e);
  }
}
