export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { db, fail, ApiError, memberMutation } from "../../../../../lib/server";
export async function POST(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const b = await r.json(),
      id = (await params).id;
    const want = await db.want.findUnique({
      where: { id },
      include: { offers: true },
    });
    if (!want) throw new ApiError(404, "WANT_NOT_FOUND", "Want not found");
    if (b.actorMemberId !== want.memberId)
      throw new ApiError(
        403,
        "OWNER_REQUIRED",
        "Only owner can clear acceptance",
      );
    const response = await memberMutation(want.memberId, b, async (tx) => {
      const fresh = await tx.offer.findFirst({
        where: { wantId: id, status: "accepted" },
      });
      if (!fresh || fresh.id !== b.expectedAcceptedOfferId)
        throw new ApiError(409, "ACCEPTANCE_CHANGED", "Accepted offer changed");
      await tx.offer.update({
        where: { id: fresh.id },
        data: { status: "open" },
      });
      return {};
    });
    return Response.json(response);
  } catch (e) {
    return fail(e);
  }
}
